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
            $table->string('payload_hash', 64)->nullable()->after('payload');
            $table->string('ticket', 80)->nullable()->unique()->after('payload_hash');
            $table->string('cdr_code', 10)->nullable()->after('ticket');
            $table->unsignedSmallInteger('attempts')->default(0)->after('cdr_code');
            $table->timestamp('last_attempt_at')->nullable()->after('attempts');
            $table->timestamp('next_retry_at')->nullable()->after('last_attempt_at');
            $table->timestamp('sent_at')->nullable()->after('next_retry_at');
            $table->timestamp('processed_at')->nullable()->after('sent_at');

            $table->index(['estado_sunat', 'next_retry_at']);
            $table->index('payload_hash');
        });
    }

    public function down(): void
    {
        Schema::table('sunat_documents', function (Blueprint $table): void {
            $table->dropIndex(['estado_sunat', 'next_retry_at']);
            $table->dropIndex(['payload_hash']);
            $table->dropUnique(['ticket']);
            $table->dropColumn([
                'payload_hash',
                'ticket',
                'cdr_code',
                'attempts',
                'last_attempt_at',
                'next_retry_at',
                'sent_at',
                'processed_at',
            ]);
        });
    }
};
