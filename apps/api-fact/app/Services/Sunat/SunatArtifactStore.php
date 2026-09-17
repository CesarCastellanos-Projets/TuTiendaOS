<?php

declare(strict_types=1);

namespace App\Services\Sunat;

use App\Models\SunatDocument;
use Barryvdh\DomPDF\Facade\Pdf;
use Greenter\See;
use Illuminate\Support\Facades\Storage;

final class SunatArtifactStore
{
    public function storeXml(See $see, SunatDocument $document): void
    {
        $xml = $see->getFactory()?->getLastXml();
        if (! is_string($xml) || $xml === '') {
            return;
        }
        $path = $this->basePath($document).'.xml';
        if (Storage::put($path, $xml)) {
            $document->xml_path = $path;
        }
    }

    public function storeCdr(SunatDocument $document, ?string $cdrZip): void
    {
        if ($cdrZip === null || $cdrZip === '') {
            return;
        }
        $path = $this->basePath($document).'-cdr.zip';
        if (Storage::put($path, $cdrZip)) {
            $document->cdr_path = $path;
        }
    }

    public function storePdf(SunatDocument $document): void
    {
        $path = $this->basePath($document).'.pdf';
        $pdf = Pdf::loadView('sunat.document', ['document' => $document])->setPaper('a4');
        if (Storage::put($path, $pdf->output())) {
            $document->pdf_path = $path;
        }
    }

    private function basePath(SunatDocument $document): string
    {
        $ruc = preg_replace('/\D+/', '', (string) SunatConfigHelper::get('ruc', config('sunat.ruc', '20000000001')));
        $identity = implode('-', [
            $document->tipo,
            $document->serie,
            (string) $document->correlativo,
        ]);
        $safeIdentity = preg_replace('/[^A-Za-z0-9_-]+/', '-', $identity) ?? 'documento';

        $tenantId = (string) config('sunat.tenant_id', 'denzoz');

        return "sunat/{$tenantId}/{$ruc}/{$safeIdentity}";
    }
}
