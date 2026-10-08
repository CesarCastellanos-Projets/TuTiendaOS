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
            $table->timestamp('send_lease_until')->nullable();
        });
        Schema::create('sunat_sequences', function (Blueprint $table): void {
            $table->string('tenant_id', 63);
            $table->string('tipo', 30);
            $table->string('serie', 4);
            $table->unsignedInteger('current')->default(0);
            $table->primary(['tenant_id', 'tipo', 'serie']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sunat_sequences');
        Schema::table('sunat_documents', fn (Blueprint $table) => $table->dropColumn('send_lease_until'));
    }
};
