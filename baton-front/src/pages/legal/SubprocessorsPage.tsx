import { LegalLayout } from './LegalLayout';

const UPDATED_AT = '2026-07-19';

interface Subprocessor {
  name: string;
  purpose: string;
  data: string;
  location: string;
  url: string;
}

const SUBPROCESSORS: Subprocessor[] = [
  {
    name: 'Amazon Web Services (AWS)',
    purpose: 'Cloud infrastructure - compute (EC2/Lambda), storage (S3, DynamoDB), key management (KMS), networking',
    data: 'All Baton service data and customer content at rest',
    location: 'United States (us-east-1, us-east-2)',
    url: 'https://aws.amazon.com/compliance/data-privacy/',
  },
  {
    name: 'Microsoft Clarity',
    purpose: 'In-app product analytics - heatmaps and session replays for UX improvement',
    data: 'Page views, clicks, anonymized user ID, browser/device metadata',
    location: 'United States',
    url: 'https://privacy.microsoft.com/en-us/privacystatement',
  },
  {
    name: 'Datadog, Inc.',
    purpose: 'Application observability - logs, metrics, distributed tracing, and uptime monitoring',
    data: 'Server-side application logs (request URLs with PII fields scrubbed, user ID for correlation, error stack traces), performance metrics, HTTP request traces',
    location: 'United States',
    url: 'https://www.datadoghq.com/legal/privacy/',
  },
];

export default function SubprocessorsPage() {
  return (
    <LegalLayout title="Sub-processors" updatedAt={UPDATED_AT}>
      <div className="mb-8 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <strong>Hosted service only.</strong> This page describes the sub-processors used by
        FluidLabs' hosted Baton service. If you run a self-hosted Baton installation, none of
        these providers are involved - your installation has its own infrastructure and
        sub-processor relationships, which you manage.
      </div>

      <p>
        Baton uses the following third-party service providers ("sub-processors")
        to deliver the Services. Each sub-processor is bound by a written
        contract that imposes data-protection obligations at least as protective
        as our agreement with you, and limits the sub-processor's use of personal
        data to the purposes Baton has authorized.
      </p>

      <p>
        We will notify customers of new sub-processors by email and by updating
        this page at least 30 days before the new sub-processor begins
        processing customer data. Customers may object to a new sub-processor
        on reasonable grounds by emailing <a href="mailto:app-support@fluidlabs.com">app-support@fluidlabs.com</a> within
        that window.
      </p>

      <p>
        For the third-party platforms you yourself connect through Baton
        (Salesforce, DocuSign, etc.), those platforms are <em>not</em>{' '}
        sub-processors of Baton. They are independent controllers/processors
        with their own privacy policies, and your direct agreement with them
        governs the data they hold.
      </p>

      <h2 id="current-list">Current sub-processors</h2>

      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Purpose</th>
            <th>Data accessed</th>
            <th>Region</th>
            <th>Policy</th>
          </tr>
        </thead>
        <tbody>
          {SUBPROCESSORS.map((s) => (
            <tr key={s.name}>
              <td><strong>{s.name}</strong></td>
              <td>{s.purpose}</td>
              <td>{s.data}</td>
              <td>{s.location}</td>
              <td>
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  link
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 id="dpa">Data Processing Agreement</h2>
      <p>
        A signed Data Processing Agreement (DPA) incorporating the European
        Commission's Standard Contractual Clauses is available on request.
        Email <a href="mailto:app-support@fluidlabs.com">app-support@fluidlabs.com</a> with
        your organization name and a counter-signature contact.
      </p>

      <h2 id="contact">Contact</h2>
      <p>
        Questions about a specific sub-processor or our overall data-flow
        topology should be directed to <a href="mailto:app-support@fluidlabs.com">app-support@fluidlabs.com</a>.
      </p>
    </LegalLayout>
  );
}
