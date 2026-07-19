import { Link } from 'react-router-dom';
import { Plug, Cloud, Zap, Wrench, Bell, Webhook } from 'lucide-react';
import { Hero, Lead, Callout, Cards, Card, TableWrap, FlowStrip, FlowNode, DocLink } from '../ui';
import { GROUPS } from '../registry';

const QUICK_PATHS: { slug: string; task: string; icon: React.ReactNode }[] = [
  { slug: 'connect-docusign', task: 'Connect my Docusign account', icon: <Plug /> },
  { slug: 'salesforce',       task: 'Send events from Salesforce', icon: <Cloud /> },
  { slug: 'quick-start',      task: 'Build my first automation',   icon: <Zap /> },
  { slug: 'control-center',   task: 'Fix a failed workflow run',   icon: <Wrench /> },
  { slug: 'notifications',    task: 'Get alerted when something breaks', icon: <Bell /> },
  { slug: 'custom-webhook',   task: 'Send events from any system', icon: <Webhook /> },
];

export default function Welcome() {
  return (
    <>
      <Hero pill="User Guide" title="Run your Docusign Maestro workflows on autopilot">
        Baton listens for events from the business platforms you already use, then launches the right
        Docusign&nbsp;Maestro workflow automatically — and gives you one screen to watch it all run.
      </Hero>

      <Lead>
        This guide explains what Baton does, how the pieces fit together, and exactly how to set up and
        operate your automations. If you're brand new, read{' '}
        <DocLink to="how-it-works">How Baton works</DocLink>, then follow the{' '}
        <DocLink to="quick-start">Quick start</DocLink>.
      </Lead>

      <h2>I want to…</h2>
      <p>Jump straight to what you're here to do:</p>
      <div className="bd-quickpaths">
        {QUICK_PATHS.map((q) => (
          <Link key={q.slug} className="bd-quickpath" to={`/docs/${q.slug}`}>
            <span className="bd-quickpath__icon">{q.icon}</span>
            <span className="bd-quickpath__body">
              <span className="bd-quickpath__eyebrow">I want to</span>
              <span className="bd-quickpath__title">{q.task} <span className="arrow">→</span></span>
            </span>
          </Link>
        ))}
      </div>

      <h2>What is Baton?</h2>
      <p>
        <strong>Baton is a webhook-focused command center for Docusign Maestro workflows.</strong> It sits
        between your business platforms (Salesforce, HubSpot, Procore, Xero, and more) and Docusign Maestro:
      </p>
      <ol>
        <li>A platform you use fires an <strong>event</strong> — a deal closes, a record is created, a project reaches a stage.</li>
        <li>That event reaches Baton as a <strong>webhook</strong>.</li>
        <li>Baton verifies it, finds the value Maestro needs, and <strong>launches the matching Maestro workflow</strong>.</li>
        <li>Baton keeps watching the workflow and shows you its status — completed, running, or failed — without you ever opening Docusign.</li>
      </ol>

      <FlowStrip>
        <FlowNode k="Source" t="Your platform" d="Salesforce, HubSpot, Procore…" />
        <FlowNode k="Webhook" t="Baton" d="Verifies & routes the event" />
        <FlowNode k="Launch" t="Maestro" d="Runs your signing workflow" />
        <FlowNode k="Watch" t="Flow Builder" d="Live status & error fixing" />
      </FlowStrip>

      <Callout type="note" title="Baton doesn't replace Maestro — it feeds it">
        Baton's job is the first link in the chain: receive an event and trigger the correct workflow. Once a
        workflow launches, <strong>Maestro runs its own steps</strong> (sending envelopes, calling extension
        apps, collecting signatures). Baton then monitors the result.
      </Callout>

      <h2>Who Baton is for</h2>
      <p>
        Baton is built for the <strong>admin</strong> who owns an organization's agreement automation —
        operations, revenue ops, or IT. In one place you connect your tools, wire up automations, and keep
        them healthy. Everyone who signs in to Baton is an admin of their organization.
      </p>

      <h2>The six screens you'll use</h2>
      <p>The Baton app is intentionally small. Once you're set up, you'll spend your time across these screens:</p>
      <TableWrap>
        <table>
          <thead>
            <tr><th>Screen</th><th>What it's for</th></tr>
          </thead>
          <tbody>
            <tr><td><DocLink to="flow-builder"><strong>Flow Builder</strong></DocLink></td><td>Your home page — a visual map of every automation with live counts. Default landing screen.</td></tr>
            <tr><td><DocLink to="control-center"><strong>Resolution Center</strong></DocLink></td><td>The fix-it queue. Retry, cancel, or report failed workflow runs.</td></tr>
            <tr><td><DocLink to="workflows"><strong>Workflow Checker</strong></DocLink></td><td>Every Maestro workflow you have, with a button to launch any of them for testing.</td></tr>
            <tr><td><DocLink to="connections"><strong>Connections</strong></DocLink></td><td>Manage your Docusign connection and the platforms sending webhooks to Baton.</td></tr>
            <tr><td><DocLink to="notifications"><strong>Notifications</strong></DocLink></td><td>Choose how you're alerted and read the in-app feed of everything that happened.</td></tr>
            <tr><td><DocLink to="settings"><strong>Settings</strong></DocLink></td><td>Organization details, billing, and plan management.</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <h2>Browse the documentation</h2>
      <p>Every page, grouped by what you're trying to do. Open a section to see just its pages.</p>
      {GROUPS.map((group) => (
        <section key={group.slug}>
          <h3>
            <Link to={`/docs/section/${group.slug}`}>{group.title}</Link>
          </h3>
          <p>{group.intro}</p>
          <Cards>
            {group.items
              .filter((it) => it.slug !== 'welcome')
              .map((it) => (
                <Card key={it.slug} to={it.slug} title={it.title}>
                  {it.description}
                </Card>
              ))}
          </Cards>
        </section>
      ))}
    </>
  );
}
