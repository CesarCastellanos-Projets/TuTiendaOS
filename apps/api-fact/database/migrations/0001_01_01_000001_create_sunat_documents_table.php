<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sunat_documents', function (Blueprint $table) {
            $table->id();
            $table->string('ref')->index();
            $table->string('tipo'); // boleta | factura | nota_credito | resumen | baja
            $table->string('serie', 8);
            $table->unsignedBigInteger('correlativo')->default(0);
            $table->string('cliente_tipo', 10)->nullable();
            $table->string('cliente_numero', 15)->nullable();
            $table->string('cliente_nombre', 120)->nullable();
            $table->decimal('total', 12, 2)->default(0);
            $table->string('estado_sunat', 20)->default('pendiente');
            $table->text('mensaje_sunat')->nullable();
            $table->string('xml_path')->nullable();
            $table->string('cdr_path')->nullable();
            $table->string('pdf_path')->nullable();
            $table->json('payload')->nullable();
            $table->timestamps();

            $table->unique(['tipo', 'serie', 'correlativo']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sunat_documents');
    }
};
