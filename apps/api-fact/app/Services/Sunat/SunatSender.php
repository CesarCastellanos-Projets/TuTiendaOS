<?php

namespace App\Services\Sunat;

use App\Models\SunatDocument;
use Greenter\Model\Response\BillResult;
use Greenter\See;

class SunatSender
{
    /** Envía el documento y persiste estado + XML + CDR. */
    public static function send(See $see, object $document, SunatDocument $record): SunatDocument
    {
        $result = $see->send($document);

        if ($result->isSuccess()) {
            /** @var BillResult|null $cdr */
            $cdr = method_exists($result, 'getCdrResponse') ? $result : null;
            $response = $result->getCdrResponse();
            $aceptado = $response?->isAccepted() ?? true;

            $record->estado_sunat = $aceptado ? 'aceptado' : 'observado';
            $record->mensaje_sunat = implode(' ', $response?->getNotes() ?? [$response?->getDescription() ?? 'Aceptado']);
        } else {
            $record->estado_sunat = 'rechazado';
            $record->mensaje_sunat = $result->getError()->getMessage();
        }

        // XML firmado
        try {
            $xml = $see->getFactory()?->getLastXml();
            if ($xml) {
                $dir = "sunat/".config('sunat.ruc');
                \Storage::makeDirectory($dir);
                $path = "{$dir}/{$record->tipo}-{$record->serie}-{$record->correlativo}.xml";
                \Storage::put($path, $xml);
                $record->xml_path = $path;
            }
        } catch (\Throwable) {
            // El XML es recuperable; no bloquea la respuesta
        }

        $record->save();

        return $record;
    }
}
