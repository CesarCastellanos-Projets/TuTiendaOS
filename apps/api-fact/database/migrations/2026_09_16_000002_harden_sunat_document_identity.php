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
            $table->foreignId('original_document_id')
                ->nullable()
                ->after('id')
                ->constrained('sunat_documents')
                ->restrictOnDelete();
            $table->unique('ref');
            $table->unique('original_document_id');
        });
    }

    public function down(): void
    {
        Schema::table('sunat_documents', function (Blueprint $table): void {
            $table->dropUnique(['original_document_id']);
            $table->dropUnique(['ref']);
            $table->dropConstrainedForeignId('original_document_id');
        });
    }
};
