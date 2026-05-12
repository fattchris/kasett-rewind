/**
 * Build 5 Tier 4 high-complexity fixtures.
 *
 * Each fixture embeds known threads and key state values across a long
 * conversation that simulates a multi-session, multi-topic engineering day.
 *
 * Output: fixtures/session-11.json … session-15.json
 */

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures');

// Helper to weave thread chunks and produce role-alternating messages.
function weave(chunks, opener) {
  // chunks: array of { thread, exchanges: [[user, assistant], ...] }
  // Returns flat message list, opening with `opener` user message,
  // then interleaving exchanges round-robin across threads, then closing.
  const msgs = [];
  if (opener) msgs.push({ role: 'user', content: opener });

  const queues = chunks.map((c) => [...c.exchanges]);
  let progress = true;
  while (progress) {
    progress = false;
    for (const q of queues) {
      if (q.length === 0) continue;
      const [u, a] = q.shift();
      msgs.push({ role: 'user', content: u });
      msgs.push({ role: 'assistant', content: a });
      progress = true;
    }
  }
  return msgs;
}

// ---------------------------------------------------------------------------
// session-11: 8 threads, 25 key state values, 120 turns
// ---------------------------------------------------------------------------
function session11() {
  const threads = [
    'migrating EKS workloads to GKE for cost optimization',
    'refactoring auth middleware to use OIDC instead of static JWTs',
    'investigating intermittent 504 errors on customer dashboard',
    'implementing rate limiting on the public API gateway',
    'rotating production database credentials and updating Vault paths',
    'building Terraform module for new VPC peering setup',
    'onboarding new SRE engineer with runbook updates',
    'preparing SOC 2 Type II audit evidence collection',
  ];
  const keyState = {
    eks_cluster_arn: 'arn:aws:eks:us-east-1:492372116065:cluster/molt-prod',
    gke_cluster_id: 'gke-prod-molt-us-central1-a',
    oidc_issuer_url: 'https://auth.moltai.com/realms/prod',
    jwt_signing_key_id: 'kid-2026-05-prod-001',
    error_rate_threshold: '0.5%',
    affected_endpoint: '/api/v2/dashboard/metrics',
    sentry_issue_id: 'PROJ-12847',
    rate_limit_redis_url: 'redis://rl-prod.cache.amazonaws.com:6379/3',
    rate_limit_default: '1000 req/min',
    db_master_endpoint: 'molt-prod.cluster-cqm9w.us-east-1.rds.amazonaws.com:5432',
    new_db_password_vault_path: 'kv/prod/db/master/v3',
    old_db_password_vault_path: 'kv/prod/db/master/v2',
    vpc_peering_id: 'pcx-0a8c4e7f23b9d1e5a',
    new_sre_email: 'maya.lin@moltaicorp.com',
    runbook_url: 'https://wiki.moltaicorp.com/sre/runbooks/incident-response-v4',
    soc2_evidence_bucket: 's3://moltai-soc2-evidence/2026-q2/',
    soc2_audit_window: '2026-04-01 to 2026-06-30',
    auditor_contact: 'audit-pm@trustwave.com',
    gke_node_pool: 'standard-32-spot-pool',
    vault_namespace: 'admin/molt-prod',
    monthly_eks_spend: '$28,400',
    target_gke_spend: '$11,200',
    runbook_pr_id: '#1247',
    api_gateway_id: 'agi-9k3jx7q2vp',
    auth_session_ttl: '8h',
  };

  const chunks = [
    {
      thread: threads[0],
      exchanges: [
        ['Pulling cost numbers — EKS prod is at $28,400/month. What does GKE quote for equivalent capacity?', 'GKE quote for similar capacity on a standard-32-spot-pool node pool is roughly $11,200/month — about 60% reduction. The cluster id will be gke-prod-molt-us-central1-a.'],
        ['Confirm: gke-prod-molt-us-central1-a is in us-central1-a zone, right?', 'Correct. Single-zone for now to minimize cross-zone egress costs while we validate. The EKS cluster we are migrating from is arn:aws:eks:us-east-1:492372116065:cluster/molt-prod.'],
        ['What workloads go first?', 'Stateless API workers first. Customer dashboard last because of the 504 issue we are still debugging. Target monthly spend: $11,200 vs current $28,400.'],
      ],
    },
    {
      thread: threads[1],
      exchanges: [
        ['Status on OIDC migration?', 'OIDC issuer is up at https://auth.moltai.com/realms/prod. Currently cutting over the auth middleware to validate against that instead of the static JWT signing key.'],
        ['New JWT key id?', 'kid-2026-05-prod-001 — this is the OIDC-signed key id we are validating against. Auth session TTL set to 8h to match the old static config.'],
        ['Are we keeping backwards compat for old tokens?', 'Yes, dual-path validation for 30 days. After that we drop the static path and only honor OIDC tokens with kid kid-2026-05-prod-001.'],
      ],
    },
    {
      thread: threads[2],
      exchanges: [
        ['504 errors on the dashboard — any update?', 'Sentry issue PROJ-12847 shows error rate at about 0.7%, just above our 0.5% threshold. Affecting /api/v2/dashboard/metrics specifically.'],
        ['Is it the same endpoint every time?', 'Always /api/v2/dashboard/metrics. Looks like an upstream timeout to the analytics service. Holding off on the GKE migration of dashboard until this is resolved.'],
        ['Roll back the recent dashboard deploy?', 'Already tried. Issue persisted on previous build too. Not a new regression — looks pre-existing but only now exceeding the 0.5% threshold.'],
      ],
    },
    {
      thread: threads[3],
      exchanges: [
        ['Rate limiter status?', 'Redis backend up at redis://rl-prod.cache.amazonaws.com:6379/3. Default policy is 1000 req/min per token. API gateway id agi-9k3jx7q2vp will route through it.'],
        ['Per-tier overrides?', 'Free tier 100/min, paid 1000/min, enterprise 10000/min. All keyed by token claims. Default 1000 req/min applies if claim is absent.'],
        ['Deploy timeline?', 'Soft launch tomorrow (read-only headers, no enforcement). Hard cutover end of week assuming 504 fixed.'],
      ],
    },
    {
      thread: threads[4],
      exchanges: [
        ['DB credential rotation — where are we?', 'New password written to kv/prod/db/master/v3. Old creds at kv/prod/db/master/v2 still active for 24h grace period. Vault namespace admin/molt-prod.'],
        ['Master endpoint?', 'molt-prod.cluster-cqm9w.us-east-1.rds.amazonaws.com:5432 — same endpoint, just creds rotating.'],
        ['When does v2 path get deleted?', '24h after all services confirm successful auth via v3. We will revoke v2 manually after the metrics dashboard signals all good.'],
      ],
    },
    {
      thread: threads[5],
      exchanges: [
        ['VPC peering Terraform module — ready for review?', 'Module is up. Peering connection id is pcx-0a8c4e7f23b9d1e5a. PR is #1247 in the infra repo.'],
        ['Test plan?', 'Apply to sandbox first, then prod. Sandbox already shows successful peering across the two VPCs.'],
        ['Approval needed?', 'Need network lead sign-off before prod apply. PR #1247 is the canonical review request.'],
      ],
    },
    {
      thread: threads[6],
      exchanges: [
        ['New SRE start date?', 'Maya Lin starts Monday. Email maya.lin@moltaicorp.com. Day one onboarding is the runbook walkthrough.'],
        ['Runbook URL?', 'https://wiki.moltaicorp.com/sre/runbooks/incident-response-v4 — newly updated to reflect the OIDC migration and the rate limiter rollout.'],
        ['Anyone shadowing her?', 'Yes, pairing with senior on-call for the first two weeks. Hand-off after that.'],
      ],
    },
    {
      thread: threads[7],
      exchanges: [
        ['SOC 2 audit window?', 'Type II window is 2026-04-01 to 2026-06-30. Auditor PM is audit-pm@trustwave.com. Evidence going into s3://moltai-soc2-evidence/2026-q2/.'],
        ['Bucket access controls verified?', 'Yes — only the audit IAM role can read. Bucket has SSE-KMS, versioning, MFA delete enabled.'],
        ['Outstanding items?', 'Just the credential rotation evidence (covered by the v3 vault path) and the OIDC cutover docs. Both should land this week.'],
      ],
    },
  ];

  const messages = weave(chunks, "Standup time — today's plan covers the GKE migration, OIDC cutover, the dashboard 504, rate limiter rollout, DB rotation, VPC peering review, SRE onboarding, and SOC 2 evidence. Walk me through each.");
  // pad to ~120 turns
  while (messages.length < 120) {
    const idx = messages.length % chunks.length;
    messages.push({ role: 'user', content: `Anything else on ${chunks[idx].thread}?` });
    messages.push({ role: 'assistant', content: `No new updates on that thread since the last message. Status: in progress per earlier notes.` });
  }

  return {
    id: 'session-11',
    tier: 4,
    threads,
    keyState,
    messages: messages.slice(0, 120),
  };
}

// ---------------------------------------------------------------------------
// session-12: 6 threads with mid-session renames, 20 key state values, 100 turns
// ---------------------------------------------------------------------------
function session12() {
  const threads = [
    'redesigning the customer onboarding flow (originally called signup-v2, renamed mid-session to customer-onboarding-revamp)',
    'pricing tier restructuring from 3-tier to 4-tier model',
    'integrating Stripe billing portal with custom domain',
    'building usage analytics dashboard for product team',
    'refactoring email service from Mailgun to Postmark',
    'GDPR data export feature implementation',
  ];
  const keyState = {
    new_thread_name: 'customer-onboarding-revamp',
    old_thread_name: 'signup-v2',
    figma_url: 'https://figma.com/file/aBcD3fGhI4j/onboarding-revamp',
    new_pricing_starter: '$49/mo',
    new_pricing_pro: '$199/mo',
    new_pricing_business: '$499/mo',
    new_pricing_enterprise: 'custom',
    stripe_portal_domain: 'billing.moltaicorp.com',
    stripe_account_id: 'acct_1OqB7zE2k9jX4mPp',
    analytics_db: 'molt-analytics-prod.aurora.us-east-1',
    analytics_dashboard_url: 'https://dashboards.moltaicorp.com/product-usage-v2',
    postmark_server_token: 'pm-server-token-2026-05',
    mailgun_eol_date: '2026-06-15',
    transactional_email_domain: 'mail.moltaicorp.com',
    gdpr_export_endpoint: '/api/v2/users/{id}/data-export',
    export_bucket: 's3://moltai-gdpr-exports-prod',
    export_signed_url_ttl: '24h',
    pii_columns_count: '47',
    onboarding_pr: '#892',
    pricing_pr: '#897',
  };

  const chunks = [
    {
      thread: threads[0],
      exchanges: [
        ['Kicking off signup-v2 today — Figma link?', 'Figma is at https://figma.com/file/aBcD3fGhI4j/onboarding-revamp. signup-v2 covers the whole post-signup flow up to first value.'],
        ['Quick rename — let us call this customer-onboarding-revamp from now on. signup-v2 is too narrow.', 'Got it. Renaming the thread from signup-v2 to customer-onboarding-revamp. PR will land as #892.'],
        ['Reference both names in the PR description so search works?', 'Yes — PR #892 will mention both customer-onboarding-revamp (current name) and signup-v2 (legacy name) in the description.'],
      ],
    },
    {
      thread: threads[1],
      exchanges: [
        ['New pricing tiers are starter $49/mo, pro $199/mo, business $499/mo, enterprise custom. PR target?', 'PR #897 will introduce the 4-tier model: starter $49/mo, pro $199/mo, business $499/mo, enterprise custom. Coordinated with Stripe portal change.'],
        ['Effective date?', 'New customers get 4-tier starting next Monday. Existing on grandfathered 3-tier until next renewal.'],
        ['Marketing copy locked?', 'Locked. starter $49/mo, pro $199/mo, business $499/mo. Enterprise stays custom.'],
      ],
    },
    {
      thread: threads[2],
      exchanges: [
        ['Stripe portal custom domain?', 'billing.moltaicorp.com — DNS configured, Stripe verified. Stripe account is acct_1OqB7zE2k9jX4mPp.'],
        ['SSL?', 'Stripe provisions the cert automatically once DNS resolves. Already green on billing.moltaicorp.com.'],
        ['Test transaction?', 'Ran a $1 charge through the portal under acct_1OqB7zE2k9jX4mPp. Refunded immediately. Flow works end-to-end.'],
      ],
    },
    {
      thread: threads[3],
      exchanges: [
        ['Analytics dashboard for product — datasource?', 'Reading from molt-analytics-prod.aurora.us-east-1. Dashboard lives at https://dashboards.moltaicorp.com/product-usage-v2.'],
        ['Refresh cadence?', 'Hourly aggregations from raw events. Dashboard at https://dashboards.moltaicorp.com/product-usage-v2 refreshes on access.'],
        ['Access control?', 'Product team SSO group only. PII redacted at the SQL view layer.'],
      ],
    },
    {
      thread: threads[4],
      exchanges: [
        ['Email migration plan — Mailgun out by when?', 'Mailgun EOL date is 2026-06-15. Postmark server token in place: pm-server-token-2026-05. Cutover via mail.moltaicorp.com.'],
        ['Sender domain?', 'mail.moltaicorp.com is the new transactional domain. SPF, DKIM, DMARC all configured for Postmark.'],
        ['Volume sanity check?', 'Postmark plan handles up to 300k/month. Current peak about 180k. Well within limits.'],
      ],
    },
    {
      thread: threads[5],
      exchanges: [
        ['GDPR export endpoint?', 'GET /api/v2/users/{id}/data-export. Returns a signed URL into s3://moltai-gdpr-exports-prod with 24h TTL.'],
        ['How many PII columns covered?', '47 PII columns across 12 tables — full coverage per the data inventory.'],
        ['Encryption?', 'KMS-encrypted at rest. Signed URL valid 24h. Bucket is s3://moltai-gdpr-exports-prod with object-lock for compliance hold.'],
      ],
    },
  ];

  const messages = weave(chunks, "Six tracks today: customer onboarding revamp (used to be called signup-v2), pricing tier restructuring, Stripe billing portal, product analytics dashboard, email migration to Postmark, and GDPR data export. Walk through each.");
  while (messages.length < 100) {
    const idx = messages.length % chunks.length;
    messages.push({ role: 'user', content: `Open questions on ${chunks[idx].thread}?` });
    messages.push({ role: 'assistant', content: `None outstanding right now. State as previously summarized.` });
  }
  return { id: 'session-12', tier: 4, threads, keyState, messages: messages.slice(0, 100) };
}

// ---------------------------------------------------------------------------
// session-13: 10 concurrent threads, 30 key state values, 150 turns
// ---------------------------------------------------------------------------
function session13() {
  const threads = [
    'kafka cluster migration from MSK to self-hosted Strimzi on EKS',
    'PostgreSQL major version upgrade from 14 to 16',
    'frontend bundle size optimization (target sub-500KB initial load)',
    'machine learning feature store rollout',
    'deprecating legacy v1 REST API endpoints',
    'implementing distributed tracing with OpenTelemetry',
    'cost allocation tagging across all AWS resources',
    'IAM role refactor to use SSO instead of access keys',
    'feature flag system migration to LaunchDarkly',
    'on-call rotation overhaul — moving from PagerDuty to Opsgenie',
  ];
  const keyState = {
    msk_cluster_arn: 'arn:aws:kafka:us-east-1:492372116065:cluster/msk-prod/abc-123',
    strimzi_namespace: 'kafka-prod',
    strimzi_chart_version: '0.39.0',
    pg_old_version: '14.10',
    pg_new_version: '16.2',
    pg_endpoint: 'molt-prod-rds.cluster-xyz.us-east-1.rds.amazonaws.com',
    pg_upgrade_window: '2026-05-25 03:00 UTC',
    bundle_size_target: '500KB',
    bundle_current_size: '847KB',
    feast_registry_url: 's3://moltai-feast-registry-prod',
    feast_redis_endpoint: 'feast-online.cache.amazonaws.com:6379',
    v1_api_sunset_date: '2026-09-01',
    deprecated_endpoints_count: '34',
    otel_collector_endpoint: 'otel-collector.observability:4317',
    jaeger_query_url: 'https://jaeger.moltaicorp.com',
    cost_tag_namespace: 'moltai:',
    required_tags: 'environment,service,owner,cost-center',
    sso_url: 'https://moltaicorp.awsapps.com/start',
    sso_permission_set: 'DeveloperAccess-Prod',
    deprecated_iam_users_count: '23',
    launchdarkly_project_key: 'moltai-prod',
    launchdarkly_sdk_key_env: 'LAUNCHDARKLY_SDK_KEY',
    feature_flags_count: '156',
    opsgenie_team_id: 'team-sre-prod',
    opsgenie_integration_key: 'og-int-key-2026-05',
    pagerduty_eol_date: '2026-07-01',
    grafana_dashboard_url: 'https://grafana.moltaicorp.com/d/cost-allocation',
    okta_app_id: 'okta-app-0oa3xyz123',
    msk_eol_date: '2026-08-15',
    feast_offline_store: 's3://moltai-feast-offline-prod',
  };

  const chunks = [
    { thread: threads[0], exchanges: [
      ['Kafka migration kicking off. Source?', 'Source is arn:aws:kafka:us-east-1:492372116065:cluster/msk-prod/abc-123. Target is Strimzi 0.39.0 on EKS in namespace kafka-prod.'],
      ['MSK shutdown date?', 'MSK EOL is 2026-08-15. Strimzi chart version 0.39.0 deployed in namespace kafka-prod.'],
    ]},
    { thread: threads[1], exchanges: [
      ['PG14 to PG16 — when?', 'Maintenance window 2026-05-25 03:00 UTC. Upgrading 14.10 to 16.2 on molt-prod-rds.cluster-xyz.us-east-1.rds.amazonaws.com.'],
      ['Backup plan?', 'Snapshot before, manual rollback path documented. PG endpoint molt-prod-rds.cluster-xyz.us-east-1.rds.amazonaws.com stays the same.'],
    ]},
    { thread: threads[2], exchanges: [
      ['Bundle size status?', 'Current size 847KB, target 500KB. Tree-shaking and lazy-loading in progress.'],
      ['Biggest offender?', 'Lodash full import. Already replaced with selective imports — saved 80KB. Target 500KB still aspirational, currently 847KB.'],
    ]},
    { thread: threads[3], exchanges: [
      ['Feast registry?', 'Registry at s3://moltai-feast-registry-prod. Online store at feast-online.cache.amazonaws.com:6379. Offline store at s3://moltai-feast-offline-prod.'],
      ['First model using it?', 'Recommendation model. Registry s3://moltai-feast-registry-prod, online endpoint feast-online.cache.amazonaws.com:6379.'],
    ]},
    { thread: threads[4], exchanges: [
      ['v1 API sunset?', '2026-09-01 sunset date for 34 deprecated endpoints. Customers notified via email.'],
      ['Migration guide?', 'Published. 34 deprecated endpoints all have v2 equivalents documented. Sunset is 2026-09-01.'],
    ]},
    { thread: threads[5], exchanges: [
      ['OTel collector endpoint?', 'otel-collector.observability:4317. Jaeger query UI at https://jaeger.moltaicorp.com.'],
      ['Service coverage?', 'Auth, API gateway, billing instrumented. Sending to otel-collector.observability:4317.'],
    ]},
    { thread: threads[6], exchanges: [
      ['Cost tag namespace?', 'Tags use moltai: prefix. Required tags: environment,service,owner,cost-center. Dashboard at https://grafana.moltaicorp.com/d/cost-allocation.'],
      ['Compliance check?', 'AWS Config rule enforces required tags: environment,service,owner,cost-center. Untagged resources flagged for owner remediation.'],
    ]},
    { thread: threads[7], exchanges: [
      ['SSO URL?', 'https://moltaicorp.awsapps.com/start. Permission set DeveloperAccess-Prod. Okta app id okta-app-0oa3xyz123.'],
      ['Legacy users?', '23 IAM users to be deprecated. SSO via https://moltaicorp.awsapps.com/start with DeveloperAccess-Prod replaces them.'],
    ]},
    { thread: threads[8], exchanges: [
      ['LaunchDarkly project?', 'Project key moltai-prod. SDK key in env LAUNCHDARKLY_SDK_KEY. 156 flags migrated from legacy system.'],
      ['Flag count to migrate?', '156 flags total. Project key moltai-prod. Read SDK key from LAUNCHDARKLY_SDK_KEY env var.'],
    ]},
    { thread: threads[9], exchanges: [
      ['Opsgenie integration key?', 'og-int-key-2026-05. Team id team-sre-prod. PagerDuty EOL is 2026-07-01.'],
      ['Routing rules ported?', 'All routing rules ported to Opsgenie team team-sre-prod. Integration key og-int-key-2026-05 wired into Alertmanager.'],
    ]},
  ];

  const messages = weave(chunks, "Ten parallel tracks for Q2 platform work — Kafka migration, PG upgrade, bundle size, feature store, v1 API deprecation, distributed tracing, cost tagging, IAM/SSO, feature flags, and on-call rotation. Status on each.");
  while (messages.length < 150) {
    const idx = messages.length % chunks.length;
    messages.push({ role: 'user', content: `Any new blockers on ${chunks[idx].thread}?` });
    messages.push({ role: 'assistant', content: `No new blockers. Track status as previously stated.` });
  }
  return { id: 'session-13', tier: 4, threads, keyState, messages: messages.slice(0, 150) };
}

// ---------------------------------------------------------------------------
// session-14: 5 threads where 2 merge, 15 key state values, 80 turns
// ---------------------------------------------------------------------------
function session14() {
  const threads = [
    'unifying user notifications service (merged from email-notifications and push-notifications)',
    'centralizing logging into Datadog from CloudWatch',
    'building admin tooling for customer success team',
    'API SDK generation pipeline (TypeScript and Python)',
    'database read replica provisioning for reporting workloads',
  ];
  const keyState = {
    merged_service_name: 'molt-notifications',
    old_email_service: 'molt-email-notifications',
    old_push_service: 'molt-push-notifications',
    notifications_repo: 'github.com/moltaicorp/molt-notifications',
    datadog_api_key_secret: 'kv/prod/datadog/api-key',
    datadog_site: 'datadoghq.com',
    log_retention_days: '90',
    admin_tool_url: 'https://admin.moltaicorp.com',
    admin_auth_role: 'CustomerSuccessAdmin',
    sdk_publish_registry_ts: 'npm:@moltai/sdk',
    sdk_publish_registry_py: 'pypi:moltai-sdk',
    sdk_version_current: '3.4.0',
    read_replica_endpoint: 'molt-prod-ro.cluster-ro-xyz.us-east-1.rds.amazonaws.com',
    read_replica_instance_class: 'db.r6g.2xlarge',
    reporting_user_role: 'reporting_ro',
  };

  const chunks = [
    { thread: threads[0], exchanges: [
      ['Email notifications and push notifications — should we merge them?', 'Yes — merging molt-email-notifications and molt-push-notifications into a unified service molt-notifications. Repo github.com/moltaicorp/molt-notifications.'],
      ['Both old services deprecated?', 'Both molt-email-notifications and molt-push-notifications get retired. New unified service molt-notifications takes over. Single repo at github.com/moltaicorp/molt-notifications.'],
      ['Migration sequence?', 'Start with email channel in molt-notifications. Then push channel. Both old services (molt-email-notifications, molt-push-notifications) shut down once parity confirmed.'],
    ]},
    { thread: threads[1], exchanges: [
      ['Logging unification — Datadog?', 'Yes, centralizing into Datadog. API key in kv/prod/datadog/api-key. Site is datadoghq.com. Retention 90 days.'],
      ['CloudWatch decommission?', 'CloudWatch retained for AWS-native logs only. App logs all flow to datadoghq.com via the agent. Retention 90 days.'],
    ]},
    { thread: threads[2], exchanges: [
      ['Admin tool for CS team — URL?', 'https://admin.moltaicorp.com. Access scoped to CustomerSuccessAdmin role.'],
      ['Feature set?', 'Customer lookup, plan changes, refund issuance, audit trail. All gated behind CustomerSuccessAdmin role.'],
    ]},
    { thread: threads[3], exchanges: [
      ['SDK pipeline?', 'TypeScript SDK to npm:@moltai/sdk, Python SDK to pypi:moltai-sdk. Current version 3.4.0.'],
      ['Auto-publish on tag?', 'Yes, GitHub Actions publishes both npm:@moltai/sdk and pypi:moltai-sdk on git tag matching v*. Current is 3.4.0.'],
    ]},
    { thread: threads[4], exchanges: [
      ['Read replica for reporting?', 'Provisioning molt-prod-ro.cluster-ro-xyz.us-east-1.rds.amazonaws.com on db.r6g.2xlarge. Reporting role reporting_ro.'],
      ['Reporting tools pointed at it?', 'Tableau and Looker pointed at molt-prod-ro.cluster-ro-xyz.us-east-1.rds.amazonaws.com under role reporting_ro. Instance class db.r6g.2xlarge sufficient for current load.'],
    ]},
  ];
  const messages = weave(chunks, "Five tracks today including a merge — email notifications and push notifications are merging into a single service. Plus Datadog logging consolidation, admin tooling, SDK pipeline, and read replica provisioning. Walk through each.");
  while (messages.length < 80) {
    const idx = messages.length % chunks.length;
    messages.push({ role: 'user', content: `Anything new on ${chunks[idx].thread}?` });
    messages.push({ role: 'assistant', content: `Nothing new since the last update. State unchanged.` });
  }
  return { id: 'session-14', tier: 4, threads, keyState, messages: messages.slice(0, 80) };
}

// ---------------------------------------------------------------------------
// session-15: realistic mixed (4 active, 2 completed, 1 blocked), 22 keys, 110 turns
// ---------------------------------------------------------------------------
function session15() {
  const threads = [
    'rolling out new design system tokens across web app (active)',
    'incident response for last weeks production outage post-mortem (active)',
    'Q2 OKR planning and tracking spreadsheet (active)',
    'background job queue migration from Sidekiq to Temporal (active)',
    'completed: deprecation of legacy admin dashboard',
    'completed: migration of static assets to Cloudflare R2',
    'blocked: vendor contract renegotiation with current LLM provider',
  ];
  const keyState = {
    design_tokens_repo: 'github.com/moltaicorp/design-tokens',
    design_tokens_version: '2.0.1',
    storybook_url: 'https://storybook.moltaicorp.com',
    incident_id: 'INC-2026-05-08-001',
    incident_duration_min: '47',
    rca_doc_url: 'https://docs.moltaicorp.com/incidents/INC-2026-05-08-001',
    okr_sheet_url: 'https://docs.google.com/spreadsheets/d/1xyz-okr-q2-2026',
    okr_review_cadence: 'weekly Tuesday 10am MT',
    temporal_namespace: 'molt-prod',
    temporal_endpoint: 'temporal.moltaicorp.com:7233',
    sidekiq_eol_date: '2026-07-15',
    legacy_admin_decom_date: '2026-04-30',
    legacy_admin_dns: 'old-admin.moltaicorp.com',
    r2_bucket: 'moltai-static-assets',
    r2_account_id: 'cf-account-2026-05',
    r2_custom_domain: 'cdn.moltaicorp.com',
    blocked_vendor_name: 'Anthropic Enterprise Agreement',
    blocked_reason: 'awaiting new pricing tier from vendor',
    blocked_renewal_deadline: '2026-06-30',
    current_monthly_spend: '$42,000',
    target_monthly_spend: '$28,000',
    finance_lead_email: 'finance-lead@moltaicorp.com',
  };

  const chunks = [
    { thread: threads[0], exchanges: [
      ['Design tokens 2.0 status?', 'Version 2.0.1 published to github.com/moltaicorp/design-tokens. Storybook at https://storybook.moltaicorp.com shows all components updated.'],
      ['Adoption?', '60% of components migrated to design-tokens 2.0.1. Remainder this sprint.'],
    ]},
    { thread: threads[1], exchanges: [
      ['Incident post-mortem — id?', 'INC-2026-05-08-001. Duration 47 minutes. RCA at https://docs.moltaicorp.com/incidents/INC-2026-05-08-001.'],
      ['Action items tracked?', 'Yes, 4 action items in the RCA at https://docs.moltaicorp.com/incidents/INC-2026-05-08-001. All tied back to incident INC-2026-05-08-001.'],
    ]},
    { thread: threads[2], exchanges: [
      ['Q2 OKRs sheet?', 'https://docs.google.com/spreadsheets/d/1xyz-okr-q2-2026. Weekly review Tuesday 10am MT.'],
      ['Cadence locked?', 'Locked. Weekly Tuesday 10am MT review of OKRs in https://docs.google.com/spreadsheets/d/1xyz-okr-q2-2026.'],
    ]},
    { thread: threads[3], exchanges: [
      ['Temporal migration target?', 'Namespace molt-prod, endpoint temporal.moltaicorp.com:7233. Sidekiq EOL 2026-07-15.'],
      ['Workflows ported?', 'About 30% so far. Sidekiq EOL is 2026-07-15. Endpoint temporal.moltaicorp.com:7233 in namespace molt-prod is target for all of them.'],
    ]},
    { thread: threads[4], exchanges: [
      ['Legacy admin dashboard decom — done?', 'Done. Decommissioned 2026-04-30. DNS old-admin.moltaicorp.com retired.'],
      ['Anyone still hitting it?', 'No traffic on old-admin.moltaicorp.com since 2026-04-30 cutover. Marked completed.'],
    ]},
    { thread: threads[5], exchanges: [
      ['Static assets on R2 — done?', 'Done. Bucket moltai-static-assets in account cf-account-2026-05. Custom domain cdn.moltaicorp.com.'],
      ['Old S3 origin retired?', 'Yes — all traffic on cdn.moltaicorp.com via R2 bucket moltai-static-assets. S3 origin removed. Marked completed.'],
    ]},
    { thread: threads[6], exchanges: [
      ['LLM vendor renegotiation — status?', 'Blocked on vendor pricing. Anthropic Enterprise Agreement renewal deadline 2026-06-30. Current spend $42,000/mo, target $28,000/mo.'],
      ['Why blocked?', 'Awaiting new pricing tier from vendor. Finance lead finance-lead@moltaicorp.com is driving. Renewal deadline is 2026-06-30, current $42,000/mo, target $28,000/mo.'],
    ]},
  ];
  const messages = weave(chunks, "Mixed-state day. 4 active threads (design tokens, incident post-mortem, OKR planning, Sidekiq->Temporal), 2 completed (legacy admin decom, R2 static migration), 1 blocked (LLM vendor renegotiation). Status on each, especially the blocked one.");
  while (messages.length < 110) {
    const idx = messages.length % chunks.length;
    messages.push({ role: 'user', content: `Updates on ${chunks[idx].thread}?` });
    messages.push({ role: 'assistant', content: `Same status as previously reported. No new movement.` });
  }
  return { id: 'session-15', tier: 4, threads, keyState, messages: messages.slice(0, 110) };
}

// ---- Write all 5 ----
const fixtures = [session11(), session12(), session13(), session14(), session15()];
for (const fx of fixtures) {
  const path = join(FIXTURES_DIR, `${fx.id}.json`);
  writeFileSync(path, JSON.stringify(fx, null, 2));
  console.log(`Wrote ${path}: ${fx.threads.length} threads, ${Object.keys(fx.keyState).length} keys, ${fx.messages.length} messages`);
}
