<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sunat_documents', function (Blueprint $table): void {
            $table->dropUnique('sunat_documents_ref_unique');
            $table->dropUnique('sunat_documents_tipo_serie_correlativo_unique');
            $table->string('tenant_id', 63)->default('denzoz')->after('id')->index();
            $table->unique(['tenant_id', 'ref']);
            $table->unique(['tenant_id', 'tipo', 'serie', 'correlativo']);
        });
    }

    public function down(): void
    {
        Schema::table('sunat_documents', function (Blueprint $table): void {
            $table->dropUnique(['tenant_id', 'ref']);
            $table->dropUnique(['tenant_id', 'tipo', 'serie', 'correlativo']);
            $table->dropIndex(['tenant_id']);
            $table->dropColumn('tenant_id');
            $table->unique('ref');
            $table->unique(['tipo', 'serie', 'correlativo']);
        });
    }
};
