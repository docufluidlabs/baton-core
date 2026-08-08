/**
 * Baton docs — platform setup guides.
 *
 * Data-driven from the public platform catalog, so the steps, supported events
 * and secret model always match what the product actually supports. Mirrors the
 * in-app connector setup page, rendered with docs styling.
 */
import { usePublicCatalog, type PlatformTemplate } from './useCatalog';
import { Lead, Callout, Cards, Card, Steps, Step, TableWrap, DocLink } from './ui';

// Salesforce needs a hand-built outbound call — it has its own docs page.
const SPECIAL_CASE_SLUGS = new Set(['salesforce']);

/**
 * Which of the four secret models a platform uses. The public catalog endpoint
 * deliberately strips `verificationMethod`, so this has to be read off the
 * labels - the same three signals the in-app connector page uses.
 *
 * The shared-token case matters because the copy direction is reversed: with
 * HMAC you copy a secret *out of* the platform, but with a token you invent it
 * and paste it *into* the platform (Airtable, "Webhook Token").
 */
function secretModel(t: PlatformTemplate) {
  const isBasicAuth = !!(t.secretUsernameLabel || t.secretPasswordLabel);
  const hasNoSecret = /no secret/i.test(t.secretKeyLabel);
  const isSharedToken = !isBasicAuth && !hasNoSecret && /\btoken\b/i.test(t.secretKeyLabel);
  return { isBasicAuth, hasNoSecret, isSharedToken };
}

// ─── Overview: list every platform with a setup guide ───────────────────────
export function SetupOverview() {
  const { data, isLoading, error } = usePublicCatalog();
  const templates = (data?.templates ?? [])
    .filter((t) => !SPECIAL_CASE_SLUGS.has(t.slug))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  // Group by category for structure.
  const byCategory = new Map<string, PlatformTemplate[]>();
  templates.forEach((t) => {
    const cat = t.category || 'Other';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(t);
  });
  const categories = Array.from(byCategory.keys()).sort();

  return (
    <>
      <h1>Setup guides</h1>
      <Lead>
        Step-by-step instructions for connecting each supported platform to Baton. Pick your platform to
        get the exact steps, the events you can trigger on, and a troubleshooting checklist.
      </Lead>

      <p>
        Every guide follows the same shape: create an automation in Baton to get a unique{' '}
        <strong>Webhook URL</strong>, register that URL in the source platform, then send a test event. For
        the concepts behind this, see <DocLink to="how-it-works">How Baton works</DocLink> and{' '}
        <DocLink to="connections">Source platforms</DocLink>.
      </p>

      <Callout type="note" title="Salesforce works differently">
        Salesforce has no native outbound webhook - you build the outbound call in your org with a
        Record-Triggered Flow and an Apex callout. (A classic Outbound Message can't be used: it sends SOAP
        XML and cannot set the signature header.) See the{' '}
        <DocLink to="salesforce">Salesforce setup</DocLink> guide.
      </Callout>

      {isLoading && <p>Loading the platform catalog…</p>}
      {error && (
        <Callout type="warning" title="Couldn't load the catalog">
          The list of platforms isn't available right now. Try again shortly, or browse{' '}
          <DocLink to="catalog">Supported platforms</DocLink>.
        </Callout>
      )}

      {categories.map((cat) => (
        <section key={cat}>
          <h2>{cat}</h2>
          <Cards>
            {byCategory.get(cat)!.map((t) => (
              <Card key={t.slug} to={`setup/${t.slug}`} title={t.name}>
                {t.description}
              </Card>
            ))}
          </Cards>
        </section>
      ))}

      <h2>Not in the list?</h2>
      <p>
        If your system can send an HTTP request when something happens, you can still connect it with a{' '}
        <DocLink to="custom-webhook">custom POST webhook</DocLink>. Need a platform certified or added?
        Email <a href="mailto:app-support@fluidlabs.com">app-support@fluidlabs.com</a>.
      </p>
    </>
  );
}

// ─── Per-platform guide ─────────────────────────────────────────────────────
export function SetupGuide({ template }: { template: PlatformTemplate }) {
  const { name } = template;
  const { isBasicAuth, hasNoSecret, isSharedToken } = secretModel(template);

  return (
    <>
      <p className="bd-eyebrow">Setup guide{template.category ? ` · ${template.category}` : ''}</p>
      <h1>{name} setup</h1>
      <Lead>{template.description}</Lead>

      <h2>How Baton connects to {name}</h2>
      <p>
        Baton receives {name} events through a <strong>webhook</strong>. You set it up once: create an
        automation in Baton to get a unique Webhook URL, register that URL in {name}, and choose which events
        should fire it. After that, every matching event flows straight into your automations.
      </p>

      <Callout type="note" title="What you'll need">
        {hasNoSecret ? (
          <>
            {name} doesn't sign its webhook payloads - <strong>there's no secret to configure</strong>. Baton
            accepts events on the unique, hard-to-guess Webhook URL, so treat that URL like a password.
          </>
        ) : isBasicAuth ? (
          <>
            {name} authenticates with <strong>Basic Authentication</strong>. Pick a{' '}
            {template.secretUsernameLabel ?? 'username'} and {template.secretPasswordLabel ?? 'password'} and
            enter the <strong>same values</strong> in both Baton and {name} so Baton can verify each request.
          </>
        ) : isSharedToken ? (
          <>
            {name} can't sign its payloads, so it sends a <strong>shared token</strong> instead. You choose
            this one: generate a long random <strong>{template.secretKeyLabel}</strong>, save it in Baton, and
            paste the <strong>same value</strong> into {name}.
            {template.secretKeyHint ? ` ${template.secretKeyHint}` : ''}
          </>
        ) : (
          <>
            Copy the <strong>{template.secretKeyLabel}</strong> from {name} into Baton so it can verify every
            payload.{template.secretKeyHint ? ` ${template.secretKeyHint}` : ''}
          </>
        )}
      </Callout>

      <h2>Step by step</h2>
      <Steps>
        <Step title="Get your Baton webhook URL">
          In Baton open <DocLink to="flow-builder">Flow Builder</DocLink> → <strong>New Automation</strong>,
          set <strong>Source = {name}</strong>, fill in the name and target workflow, then{' '}
          <strong>Save</strong>. Copy the generated <strong>Webhook URL</strong> - you'll paste it into {name}{' '}
          next.
        </Step>
        {template.setupInstructions.map((s) => (
          <Step key={s.step} title={s.title}>
            {s.description}
          </Step>
        ))}
        <Step title="Send a test event">
          Trigger one of the events below in {name} (for example, create or update a record). Within a few
          seconds it appears in Baton's <DocLink to="logs">relay log</DocLink> and any matching automation
          runs.
        </Step>
      </Steps>

      {template.supportedEvents.length > 0 && (
        <>
          <h2>Events you can trigger on</h2>
          <TableWrap>
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Type</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {template.supportedEvents.map((e) => (
                  <tr key={e.eventType}>
                    <td>{e.label}</td>
                    <td><code>{e.eventType}</code></td>
                    <td>{e.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </>
      )}

      <h2>Troubleshooting</h2>
      <TableWrap>
        <table>
          <thead>
            <tr>
              <th>Symptom</th>
              <th>What to check</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{name} reports the webhook failed (non-2xx response)</td>
              <td>The automation may be paused or the Webhook URL has a typo - re-copy the URL from the automation in Baton and make sure the automation is Active.</td>
            </tr>
            <tr>
              <td>An event happened in {name} but nothing arrived in Baton</td>
              <td>Make sure the webhook in {name} is enabled and subscribed to that event type (see the list above).</td>
            </tr>
            {!hasNoSecret && (
              <tr>
                <td>Baton returns 401 ({isBasicAuth ? 'Unauthorized' : isSharedToken ? 'Invalid token' : 'Invalid signature'})</td>
                <td>
                  {isBasicAuth
                    ? `The Basic Auth username / password in ${name} doesn't match what you entered in Baton - re-enter the same values in both.`
                    : isSharedToken
                      ? `The ${template.secretKeyLabel} sent by ${name} doesn't match the one saved in Baton - re-paste the same value into both, with no stray whitespace.`
                      : `The ${template.secretKeyLabel} in Baton doesn't match the one in ${name} - re-copy it and save again.`}
                </td>
              </tr>
            )}
            <tr>
              <td>Events arrive but the automation doesn't run</td>
              <td>Confirm the automation is Active and its trigger conditions match the record you changed.</td>
            </tr>
          </tbody>
        </table>
      </TableWrap>

      <h2>Related</h2>
      <Cards>
        <Card to="connections" title="Source platforms">How adding and managing platforms works in Baton.</Card>
        <Card to="verification" title="Verification methods">How Baton proves each webhook is genuine.</Card>
        <Card to="flow-builder" title="Flow Builder">Create the automation that this webhook triggers.</Card>
      </Cards>
    </>
  );
}

// ─── Not found ──────────────────────────────────────────────────────────────
export function SetupNotFound({ slug }: { slug: string }) {
  return (
    <>
      <h1>No setup guide for “{slug}”</h1>
      <Lead>This platform isn't in the catalog.</Lead>
      <p>
        Browse all <DocLink to="setup">setup guides</DocLink> or the list of{' '}
        <DocLink to="catalog">supported platforms</DocLink>. If you think this is a mistake, email{' '}
        <a href="mailto:app-support@fluidlabs.com">app-support@fluidlabs.com</a>.
      </p>
    </>
  );
}
