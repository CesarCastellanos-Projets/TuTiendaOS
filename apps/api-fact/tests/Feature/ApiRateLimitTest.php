<?php

declare(strict_types=1);

namespace Tests\Feature;

use Tests\TestCase;

final class ApiRateLimitTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config()->set('sunat.api_token', 'local-only-token');
        $this->withHeader('X-API-TOKEN', 'local-only-token');
    }

    public function test_tenants_on_one_ip_have_independent_limits_with_a_global_budget(): void
    {
        config()->set('sunat.tenant_requests_per_minute', 2);
        config()->set('sunat.global_requests_per_minute', 10);
        $this->withHeader('X-TENANT-ID', 'tenant-one');
        $this->postJson('/api/invoices', [])->assertUnprocessable();
        $this->postJson('/api/invoices', [])->assertUnprocessable();
        $this->postJson('/api/invoices', [])->assertTooManyRequests()->assertHeader('Retry-After');
        $this->withHeader('X-TENANT-ID', 'tenant-two')->postJson('/api/invoices', [])->assertUnprocessable();
    }

    public function test_global_budget_is_shared_across_tenants_and_endpoints(): void
    {
        config()->set('sunat.global_requests_per_minute', 2);
        $this->withHeader('X-TENANT-ID', 'tenant-one')->postJson('/api/invoices', [])->assertUnprocessable();
        $this->withHeader('X-TENANT-ID', 'tenant-two')->postJson('/api/credit-notes', [])->assertUnprocessable();
        $this->withHeader('X-TENANT-ID', 'tenant-three')->postJson('/api/invoices', [])->assertTooManyRequests();
    }

    public function test_authentication_and_tenant_validation_run_before_counting(): void
    {
        config()->set('sunat.global_requests_per_minute', 1);
        $this->withHeader('X-API-TOKEN', 'wrong')->withHeader('X-TENANT-ID', 'tenant-one')
            ->postJson('/api/invoices', [])->assertUnauthorized();
        $this->withHeader('X-API-TOKEN', 'local-only-token')->withHeader('X-TENANT-ID', '../invalid')
            ->postJson('/api/invoices', [])->assertBadRequest();
        $this->withHeader('X-TENANT-ID', 'tenant-one')->postJson('/api/invoices', [])->assertUnprocessable();
    }
}
