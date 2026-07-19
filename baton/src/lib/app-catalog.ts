/**
 * App Catalog — Baton
 *
 * Static catalog of app templates. Each entry defines how to verify incoming
 * webhooks and guides the super-user through the setup wizard.
 *
 * Adding a new platform = one record here, zero changes to the webhook handler.
 */

import { AppSlug } from './types';

// ─── Interfaces ───────────────────────────────────────────────

export interface WebhookVerificationConfig {
  type: 'hmac_sha256' | 'hmac_hubspot_v3' | 'hmac_slack_v0' | 'hmac_bamboohr' | 'hmac_zendesk' | 'static_token' | 'none' | 'basic_auth';
  /** Header the external platform sends the signature in (lowercase). Not used for basic_auth. */
  headerName?: string;
  /** Encoding of the signature value. Not used for basic_auth. */
  encoding?: 'hex' | 'base64';
  /** Optional prefix to strip before comparing, e.g. "sha256=" */
  prefix?: string;
}

export interface SetupStep {
  step: number;
  title: string;
  description: string;
  screenshotHint?: string;
}

export interface SupportedEventType {
  eventType: string;
  label: string;
  description: string;
}

export interface AppTemplate {
  slug: AppSlug;
  name: string;
  description: string;
  logoUrl: string;
  category: string;
  icon: string;
  /** Label shown in the wizard input, e.g. "Webhook Secret Key" */
  secretKeyLabel: string;
  /** Placeholder hint for the secret key input */
  secretKeyHint: string;
  /** For basic_auth platforms: label for the username input */
  secretUsernameLabel?: string;
  /** For basic_auth platforms: label for the password input */
  secretPasswordLabel?: string;
  verificationMethod: WebhookVerificationConfig;
  setupInstructions: SetupStep[];
  supportedEvents: SupportedEventType[];
  webhookCapable: true;
}

// ─── Catalog ──────────────────────────────────────────────────

export const APP_TEMPLATES: Partial<Record<AppSlug, AppTemplate>> = {

  salesforce: {
    slug: 'salesforce',
    name: 'Salesforce',
    description: 'CRM platform — leads, opportunities, contacts, accounts',
    logoUrl: '/assets/logos/salesforce.svg',
    category: 'CRM',
    icon: '☁️',
    secretKeyLabel: 'Webhook Secret Key',
    secretKeyHint: 'Paste the secret key from your Salesforce Connected App settings',
    verificationMethod: {
      type: 'hmac_sha256',
      headerName: 'x-salesforce-signature',
      encoding: 'base64',
    },
    setupInstructions: [
      { step: 1, title: 'Open Salesforce Setup', description: 'Go to Setup → Platform Events or Outbound Messages.' },
      { step: 2, title: 'Create Outbound Message or Platform Event', description: 'Configure the event type you want to trigger on.' },
      { step: 3, title: 'Paste Baton Webhook URL', description: 'In the Endpoint URL field, paste the URL shown above.' },
      { step: 4, title: 'Copy the Secret Key', description: 'Copy the secret key from your Connected App and paste it below.' },
    ],
    supportedEvents: [
      { eventType: 'lead.created', label: 'Lead Created', description: 'A new lead was created' },
      { eventType: 'lead.updated', label: 'Lead Updated', description: 'A lead was updated' },
      { eventType: 'lead.converted', label: 'Lead Converted', description: 'A lead was converted' },
      { eventType: 'opportunity.created', label: 'Opportunity Created', description: 'A new opportunity was created' },
      { eventType: 'opportunity.updated', label: 'Opportunity Updated', description: 'An opportunity was updated' },
      { eventType: 'opportunity.closed', label: 'Opportunity Closed', description: 'An opportunity was closed' },
      { eventType: 'contact.created', label: 'Contact Created', description: 'A new contact was created' },
      { eventType: 'contact.updated', label: 'Contact Updated', description: 'A contact was updated' },
      { eventType: 'account.created', label: 'Account Created', description: 'A new account was created' },
      { eventType: 'account.updated', label: 'Account Updated', description: 'An account was updated' },
      { eventType: 'case.created', label: 'Case Created', description: 'A new case was created' },
      { eventType: 'case.updated', label: 'Case Updated', description: 'A case was updated' },
    ],
    webhookCapable: true,
  },

  hubspot: {
    slug: 'hubspot',
    name: 'HubSpot',
    description: 'CRM and marketing — contacts, deals, companies',
    logoUrl: '/assets/logos/hubspot.svg',
    category: 'CRM',
    icon: '🔶',
    secretKeyLabel: 'App Client Secret',
    secretKeyHint: 'Paste the Client Secret from your HubSpot app (under App Credentials)',
    verificationMethod: {
      type: 'hmac_hubspot_v3',
      headerName: 'x-hubspot-signature-v3',
      encoding: 'base64',
    },
    setupInstructions: [
      { step: 1, title: 'Open HubSpot Developer Portal', description: 'Go to developers.hubspot.com and navigate to your app.' },
      { step: 2, title: 'Go to Webhooks tab', description: 'In your app settings, click "Webhooks" and then "Create subscription".' },
      { step: 3, title: 'Paste Baton Webhook URL', description: 'Set the target URL to the Baton webhook URL shown above.' },
      { step: 4, title: 'Copy the Client Secret', description: 'Go to App Credentials tab and copy the Client Secret — paste it below.' },
    ],
    supportedEvents: [
      { eventType: 'contact.created', label: 'Contact Created', description: 'A new contact was created' },
      { eventType: 'contact.updated', label: 'Contact Updated', description: 'A contact was updated' },
      { eventType: 'deal.created', label: 'Deal Created', description: 'A new deal was created' },
      { eventType: 'deal.updated', label: 'Deal Updated', description: 'A deal was updated' },
      { eventType: 'company.created', label: 'Company Created', description: 'A new company was created' },
      { eventType: 'company.updated', label: 'Company Updated', description: 'A company was updated' },
    ],
    webhookCapable: true,
  },

  zohocrm: {
    slug: 'zohocrm',
    name: 'Zoho CRM',
    description: 'Customer relationship management — deals, contacts, leads',
    logoUrl: '/assets/logos/zohocrm.svg',
    category: 'CRM',
    icon: '💼',
    secretKeyLabel: 'Basic Auth Credentials',
    secretKeyHint: 'Enter the username and password you will configure in Zoho CRM',
    secretUsernameLabel: 'Basic Auth Username',
    secretPasswordLabel: 'Basic Auth Password',
    verificationMethod: {
      type: 'basic_auth',
    },
    setupInstructions: [
      { step: 1, title: 'Choose your credentials', description: 'Create a username and password for this webhook. These are not your Zoho login — choose any values you like.' },
      { step: 2, title: 'Open Zoho CRM Webhooks', description: 'Go to Setup → Developer Space → Webhooks and click "Configure Webhook".' },
      { step: 3, title: 'Paste the Baton URL', description: 'In the Webhook URL field, paste the URL shown above.' },
      { step: 4, title: 'Enable Basic Authentication', description: 'In the webhook config, select "Basic Authentication" and enter the same username and password from step 1.' },
    ],
    supportedEvents: [
      { eventType: 'deals.created', label: 'Deal Created', description: 'A new deal was created' },
      { eventType: 'deals.updated', label: 'Deal Updated', description: 'A deal was updated' },
      { eventType: 'contacts.created', label: 'Contact Created', description: 'A new contact was created' },
      { eventType: 'contacts.updated', label: 'Contact Updated', description: 'A contact was updated' },
      { eventType: 'leads.created', label: 'Lead Created', description: 'A new lead was created' },
      { eventType: 'leads.converted', label: 'Lead Converted', description: 'A lead was converted' },
    ],
    webhookCapable: true,
  },

  powerautomate: {
    slug: 'powerautomate',
    name: 'Microsoft Power Automate',
    description: 'Automate Microsoft 365 & Dataverse — flows push events into Baton via the HTTP action',
    logoUrl: '/assets/logos/powerautomate.svg',
    category: 'Automation',
    icon: '⚡',
    secretKeyLabel: 'Basic Auth Credentials',
    secretKeyHint: 'Enter the username and password you will configure on the HTTP action in your flow',
    secretUsernameLabel: 'Basic Auth Username',
    secretPasswordLabel: 'Basic Auth Password',
    verificationMethod: {
      type: 'basic_auth',
    },
    setupInstructions: [
      { step: 1, title: 'Choose your credentials', description: 'Create a username and password for this webhook. These are not your Microsoft login — choose any values you like (use a long random password).' },
      { step: 2, title: 'Add an HTTP action to your flow', description: 'In your Power Automate cloud flow, add the premium "HTTP" action after the trigger. Set Method to POST and paste the Baton URL shown above into URI.' },
      { step: 3, title: 'Set Basic authentication', description: 'In the HTTP action, expand "Advanced parameters" → set Authentication to "Basic" and enter the same username and password from step 1.' },
      { step: 4, title: 'Build the JSON body', description: 'Set the body to JSON containing at least "event" (e.g. "invoice.approved") and "recordId". Add any extra fields under "data". Save the flow.', screenshotHint: '{ "event": "invoice.approved", "recordId": "INV-1001", "data": { } }' },
    ],
    supportedEvents: [
      { eventType: 'flow.triggered', label: 'Flow Triggered', description: 'A Power Automate flow sent an event (generic)' },
      { eventType: 'item.created', label: 'Item Created', description: 'A SharePoint/Dataverse/list item was created' },
      { eventType: 'item.updated', label: 'Item Updated', description: 'A SharePoint/Dataverse/list item was updated' },
      { eventType: 'approval.completed', label: 'Approval Completed', description: 'A Power Automate approval finished' },
      { eventType: 'form.submitted', label: 'Form Submitted', description: 'A Microsoft Forms response was submitted' },
      { eventType: 'email.received', label: 'Email Received', description: 'An Outlook email arrived' },
      { eventType: '*', label: 'Any Event', description: 'Match any event string sent by the flow' },
    ],
    webhookCapable: true,
  },

  /* pipedrive: {
    slug: 'pipedrive',
    name: 'Pipedrive',
    description: 'Sales CRM — deals, persons, organizations, activities',
    logoUrl: '/assets/logos/pipedrive.svg',
    category: 'CRM',
    icon: '🟢',
    secretKeyLabel: 'Basic Auth Credentials',
    secretKeyHint: 'Enter the username and password you will configure in Pipedrive',
    secretUsernameLabel: 'Basic Auth Username',
    secretPasswordLabel: 'Basic Auth Password',
    verificationMethod: {
      type: 'basic_auth',
    },
    setupInstructions: [
      { step: 1, title: 'Choose your credentials', description: 'Create a username and password for this webhook. These are not your Pipedrive login — choose any values you like.' },
      { step: 2, title: 'Open Pipedrive Webhooks', description: 'Go to Settings → Tools and integrations → Webhooks and click "Create new webhook".' },
      { step: 3, title: 'Paste Baton Webhook URL', description: 'In the Endpoint URL field, paste the URL shown above.' },
      { step: 4, title: 'Enable HTTP Authentication', description: 'Check the "HTTP authentication" option and enter the same username and password from step 1.' },
    ],
    supportedEvents: [
      { eventType: 'deal.created', label: 'Deal Created', description: 'A new deal was created' },
      { eventType: 'deal.updated', label: 'Deal Updated', description: 'A deal was updated' },
      { eventType: 'deal.deleted', label: 'Deal Deleted', description: 'A deal was deleted' },
      { eventType: 'person.created', label: 'Person Created', description: 'A new person was created' },
      { eventType: 'person.updated', label: 'Person Updated', description: 'A person was updated' },
      { eventType: 'organization.created', label: 'Organization Created', description: 'A new organization was created' },
      { eventType: 'organization.updated', label: 'Organization Updated', description: 'An organization was updated' },
      { eventType: 'activity.created', label: 'Activity Created', description: 'A new activity was created' },
      { eventType: 'activity.updated', label: 'Activity Updated', description: 'An activity was updated' },
      { eventType: 'note.created', label: 'Note Created', description: 'A new note was added' },
    ],
    webhookCapable: true,
  }, */

  // ─── Restored platforms ───────────────────────────────────────

  /* xero: {
    slug: 'xero',
    name: 'Xero',
    description: 'Accounting and finance — invoices, contacts, payments, bank transactions',
    logoUrl: '/assets/logos/xero.svg',
    category: 'Finance',
    icon: '💹',
    secretKeyLabel: 'Webhook Key',
    secretKeyHint: 'Paste the Webhook Key from Xero App Store → Webhooks',
    verificationMethod: {
      type: 'hmac_sha256',
      headerName: 'x-xero-signature',
      encoding: 'base64',
    },
    setupInstructions: [
      { step: 1, title: 'Open Xero Developer Portal', description: 'Go to developer.xero.com → My Apps and select your app.' },
      { step: 2, title: 'Navigate to Webhooks', description: 'Click "Webhooks" in the left sidebar and then "Create webhook subscription".' },
      { step: 3, title: 'Paste Baton Webhook URL', description: 'In the URL field, paste the URL shown above and select the event types you want.' },
      { step: 4, title: 'Copy the Webhook Key', description: 'Copy the generated Webhook Key and paste it below. Note: Xero will send a validation request immediately — Baton handles this automatically.' },
    ],
    supportedEvents: [
      { eventType: 'invoice.created', label: 'Invoice Created', description: 'A new invoice was created' },
      { eventType: 'invoice.updated', label: 'Invoice Updated', description: 'An invoice was updated' },
      { eventType: 'contact.created', label: 'Contact Created', description: 'A new contact was created' },
      { eventType: 'contact.updated', label: 'Contact Updated', description: 'A contact was updated' },
      { eventType: 'payment.created', label: 'Payment Created', description: 'A payment was recorded' },
      { eventType: 'bankTransaction.created', label: 'Bank Transaction Created', description: 'A new bank transaction was created' },
    ],
    webhookCapable: true,
  }, */

  /* smartsheet: {
    slug: 'smartsheet',
    name: 'Smartsheet',
    description: 'Work management — sheets, rows, attachments, automation',
    logoUrl: '/assets/logos/smartsheet.svg',
    category: 'Productivity',
    icon: '📊',
    secretKeyLabel: 'Shared Secret',
    secretKeyHint: 'Paste the Shared Secret from your Smartsheet webhook configuration',
    verificationMethod: {
      type: 'hmac_sha256',
      headerName: 'smartsheet-hmac-sha256',
      encoding: 'base64',
    },
    setupInstructions: [
      { step: 1, title: 'Open Smartsheet Account Settings', description: 'Click your profile icon → Apps & Integrations → API Access.' },
      { step: 2, title: 'Create a Webhook via API', description: 'Use the Smartsheet API or CLI to create a webhook subscription pointing to the Baton URL shown above.' },
      { step: 3, title: 'Copy the Shared Secret', description: 'After creating the webhook, copy the sharedSecret value returned by the API.' },
      { step: 4, title: 'Paste the Shared Secret', description: 'Paste the sharedSecret below. Baton will use it to verify all incoming payloads.' },
    ],
    supportedEvents: [
      { eventType: 'sheet.updated', label: 'Sheet Updated', description: 'A sheet was modified' },
      { eventType: 'row.created', label: 'Row Created', description: 'A new row was added' },
      { eventType: 'row.updated', label: 'Row Updated', description: 'A row was updated' },
      { eventType: 'row.deleted', label: 'Row Deleted', description: 'A row was deleted' },
      { eventType: 'attachment.created', label: 'Attachment Added', description: 'A file was attached to a row or sheet' },
      { eventType: 'comment.created', label: 'Comment Added', description: 'A comment was posted' },
    ],
    webhookCapable: true,
  }, */

  // ─── New platforms ────────────────────────────────────────────

  zendesk: {
    slug: 'zendesk',
    name: 'Zendesk',
    description: 'Customer support — tickets, users, organizations, satisfaction ratings',
    logoUrl: '/assets/logos/zendesk.svg',
    category: 'Support',
    icon: '🎫',
    secretKeyLabel: 'Webhook Signing Secret',
    secretKeyHint: 'Paste the Signing Secret from your Zendesk webhook settings',
    verificationMethod: {
      type: 'hmac_zendesk',
      headerName: 'x-zendesk-webhook-signature',
      encoding: 'base64',
    },
    setupInstructions: [
      { step: 1, title: 'Open Zendesk Admin Center', description: 'Go to Admin Center → Apps and integrations → Webhooks → Create webhook.' },
      { step: 2, title: 'Connect to Zendesk events', description: 'Choose "Zendesk events" as the source, then select the event types you want (e.g. Ticket Created, Ticket Solved).' },
      { step: 3, title: 'Configure the endpoint', description: 'Set the Endpoint URL to the Baton URL shown above, Request method to POST, and Request format to JSON. Set Authentication to "None" — Baton verifies authenticity using the signing secret below, not an auth header.' },
      { step: 4, title: 'Copy the Signing Secret', description: 'After saving, open the webhook and copy its Signing Secret, then paste it below.' },
    ],
    supportedEvents: [
      { eventType: 'ticket.created', label: 'Ticket Created', description: 'A new support ticket was created' },
      { eventType: 'ticket.updated', label: 'Ticket Updated', description: 'A ticket was updated' },
      { eventType: 'ticket.solved', label: 'Ticket Solved', description: 'A ticket was marked solved' },
      { eventType: 'ticket.closed', label: 'Ticket Closed', description: 'A ticket was closed' },
      { eventType: 'user.created', label: 'User Created', description: 'A new end-user was created' },
      { eventType: 'organization.created', label: 'Organization Created', description: 'A new organization was created' },
      { eventType: 'satisfaction_rating.created', label: 'CSAT Rating Received', description: 'A satisfaction rating was submitted' },
    ],
    webhookCapable: true,
  },

  /* quickbooks: {
    slug: 'quickbooks',
    name: 'QuickBooks',
    description: 'Small business accounting — invoices, payments, customers, expenses',
    logoUrl: '/assets/logos/quickbooks.svg',
    category: 'Finance',
    icon: '📒',
    secretKeyLabel: 'Verifier Token',
    secretKeyHint: 'Paste the Verifier Token from your Intuit Developer webhook settings',
    verificationMethod: {
      type: 'hmac_sha256',
      headerName: 'intuit-signature',
      encoding: 'base64',
    },
    setupInstructions: [
      { step: 1, title: 'Open Intuit Developer Portal', description: 'Go to developer.intuit.com → Dashboard and select your app.' },
      { step: 2, title: 'Navigate to Webhooks', description: 'Click "Webhooks" in the left sidebar and then "Add endpoint".' },
      { step: 3, title: 'Paste Baton Webhook URL', description: 'Enter the Baton URL shown above as the endpoint and select the event entities you want (e.g., Invoice, Payment, Customer).' },
      { step: 4, title: 'Copy the Verifier Token', description: 'Copy the Verifier Token displayed after saving and paste it below.' },
    ],
    supportedEvents: [
      { eventType: 'Invoice.Create', label: 'Invoice Created', description: 'A new invoice was created' },
      { eventType: 'Invoice.Update', label: 'Invoice Updated', description: 'An invoice was updated' },
      { eventType: 'Invoice.Delete', label: 'Invoice Deleted', description: 'An invoice was deleted' },
      { eventType: 'Payment.Create', label: 'Payment Created', description: 'A payment was recorded' },
      { eventType: 'Payment.Update', label: 'Payment Updated', description: 'A payment was updated' },
      { eventType: 'Customer.Create', label: 'Customer Created', description: 'A new customer was created' },
      { eventType: 'Customer.Update', label: 'Customer Updated', description: 'A customer was updated' },
      { eventType: 'Bill.Create', label: 'Bill Created', description: 'A new bill was created' },
      { eventType: 'Estimate.Create', label: 'Estimate Created', description: 'A new estimate was created' },
    ],
    webhookCapable: true,
  }, */

  /* slack: {
    slug: 'slack',
    name: 'Slack',
    description: 'Team messaging — messages, channels, reactions, file sharing',
    logoUrl: '/assets/logos/slack.svg',
    category: 'Messaging',
    icon: '💬',
    secretKeyLabel: 'Signing Secret',
    secretKeyHint: 'Paste the Signing Secret from your Slack app Basic Information page',
    verificationMethod: {
      type: 'hmac_slack_v0',
      headerName: 'x-slack-signature',
      encoding: 'hex',
      prefix: 'v0=',
    },
    setupInstructions: [
      { step: 1, title: 'Open Slack API Portal', description: 'Go to api.slack.com/apps and select your app (or create one).' },
      { step: 2, title: 'Enable Event Subscriptions', description: 'Click "Event Subscriptions" in the sidebar, enable it, and paste the Baton URL shown above as the Request URL.' },
      { step: 3, title: 'Subscribe to Bot Events', description: 'Under "Subscribe to bot events", add the events you want (e.g., message.channels, reaction_added, app_mention).' },
      { step: 4, title: 'Copy Signing Secret', description: 'Go to "Basic Information" and copy the Signing Secret. Paste it below.' },
    ],
    supportedEvents: [
      { eventType: 'message.created', label: 'Message Posted', description: 'A message was posted in a channel' },
      { eventType: 'channel.created', label: 'Channel Created', description: 'A new channel was created' },
      { eventType: 'member_joined_channel', label: 'Member Joined Channel', description: 'A member joined a channel' },
      { eventType: 'member_left_channel', label: 'Member Left Channel', description: 'A member left a channel' },
      { eventType: 'reaction_added', label: 'Reaction Added', description: 'A reaction was added to a message' },
      { eventType: 'app_mention', label: 'App Mentioned', description: 'The app was mentioned in a message' },
      { eventType: 'file_shared', label: 'File Shared', description: 'A file was shared in a channel' },
    ],
    webhookCapable: true,
  },

  jira: {
    slug: 'jira',
    name: 'Jira',
    description: 'Project management — issues, sprints, projects, workflows',
    logoUrl: '/assets/logos/jira.svg',
    category: 'Project Management',
    icon: '🔷',
    secretKeyLabel: 'Secret Token',
    secretKeyHint: 'Enter a secret token — you will use the same value in Jira webhook configuration',
    verificationMethod: {
      type: 'hmac_sha256',
      headerName: 'x-hub-signature-256',
      encoding: 'hex',
      prefix: 'sha256=',
    },
    setupInstructions: [
      { step: 1, title: 'Open Jira System Settings', description: 'Go to Jira Settings (⚙️) → System → Webhooks (under Advanced).' },
      { step: 2, title: 'Create a New Webhook', description: 'Click "Create a WebHook", give it a name, and paste the Baton URL shown above.' },
      { step: 3, title: 'Select Events', description: 'Choose the issue, project, or sprint events you want to receive.' },
      { step: 4, title: 'Set Secret Token', description: 'Enter a secret token in the webhook form. Use the same value below.' },
    ],
    supportedEvents: [
      { eventType: 'jira:issue_created', label: 'Issue Created', description: 'A new issue was created' },
      { eventType: 'jira:issue_updated', label: 'Issue Updated', description: 'An issue was updated' },
      { eventType: 'jira:issue_deleted', label: 'Issue Deleted', description: 'An issue was deleted' },
      { eventType: 'sprint_created', label: 'Sprint Created', description: 'A new sprint was created' },
      { eventType: 'sprint_started', label: 'Sprint Started', description: 'A sprint was started' },
      { eventType: 'sprint_closed', label: 'Sprint Closed', description: 'A sprint was completed' },
      { eventType: 'project_created', label: 'Project Created', description: 'A new project was created' },
      { eventType: 'user_created', label: 'User Created', description: 'A new user was added' },
    ],
    webhookCapable: true,
  }, */

  /* airtable: {
    slug: 'airtable',
    name: 'Airtable',
    description: 'Collaborative database — records, fields, views, automations',
    logoUrl: '/assets/logos/airtable.svg',
    category: 'Database',
    icon: '🗃️',
    secretKeyLabel: 'Webhook Secret',
    secretKeyHint: 'Paste the MAC secret from your Airtable webhook configuration',
    verificationMethod: {
      type: 'hmac_sha256',
      headerName: 'x-airtable-content-mac',
      encoding: 'base64',
    },
    setupInstructions: [
      { step: 1, title: 'Open Airtable Developer Hub', description: 'Go to airtable.com/developers/web-api and select your base.' },
      { step: 2, title: 'Create a Webhook', description: 'Under "Webhooks", click "Create a webhook" and choose the events you want to subscribe to.' },
      { step: 3, title: 'Paste Baton Webhook URL', description: 'Set the notification URL to the Baton URL shown above.' },
      { step: 4, title: 'Copy the MAC Secret', description: 'Copy the macSecretBase64 value from the API response and paste it below.' },
    ],
    supportedEvents: [
      { eventType: 'record.created', label: 'Record Created', description: 'A new record was created' },
      { eventType: 'record.updated', label: 'Record Updated', description: 'A record was updated' },
      { eventType: 'record.deleted', label: 'Record Deleted', description: 'A record was deleted' },
      { eventType: 'field.created', label: 'Field Created', description: 'A new field was added' },
      { eventType: 'field.updated', label: 'Field Updated', description: 'A field was updated' },
      { eventType: 'view.created', label: 'View Created', description: 'A new view was created' },
    ],
    webhookCapable: true,
  }, */

  /* asana: {
    slug: 'asana',
    name: 'Asana',
    description: 'Work management — tasks, projects, teams, portfolios',
    logoUrl: '/assets/logos/asana.svg',
    category: 'Project Management',
    icon: '🎯',
    secretKeyLabel: 'Webhook Secret',
    secretKeyHint: 'Paste the secret returned when you created the Asana webhook via API',
    verificationMethod: {
      type: 'hmac_sha256',
      headerName: 'x-hook-signature',
      encoding: 'hex',
    },
    setupInstructions: [
      { step: 1, title: 'Open Asana Developer Console', description: 'Go to app.asana.com/0/developer-console and create or select your app.' },
      { step: 2, title: 'Create Webhook via API', description: 'Use the Asana API (POST /webhooks) to create a webhook with the Baton URL shown above as the target.' },
      { step: 3, title: 'Handle the Handshake', description: 'Asana sends a X-Hook-Secret header on the first request — Baton automatically handles the handshake response.' },
      { step: 4, title: 'Paste the Hook Secret', description: 'Copy the secret value returned by the API (or the handshake) and paste it below.' },
    ],
    supportedEvents: [
      { eventType: 'task.added', label: 'Task Added', description: 'A new task was created' },
      { eventType: 'task.changed', label: 'Task Changed', description: 'A task was updated' },
      { eventType: 'task.removed', label: 'Task Removed', description: 'A task was removed' },
      { eventType: 'task.undeleted', label: 'Task Restored', description: 'A deleted task was restored' },
      { eventType: 'story.created', label: 'Comment Added', description: 'A comment or story was added to a task' },
      { eventType: 'project.added', label: 'Project Added', description: 'A new project was created' },
      { eventType: 'project.changed', label: 'Project Changed', description: 'A project was updated' },
    ],
    webhookCapable: true,
  }, */

  /* coupa: {
    slug: 'coupa',
    name: 'Coupa',
    description: 'Procurement and spend management — purchase orders, invoices, suppliers',
    logoUrl: '/assets/logos/coupa.svg',
    category: 'Procurement',
    icon: '🛒',
    secretKeyLabel: 'Basic Auth Credentials',
    secretKeyHint: 'Enter the username and password you will configure in Coupa',
    secretUsernameLabel: 'Basic Auth Username',
    secretPasswordLabel: 'Basic Auth Password',
    verificationMethod: {
      type: 'basic_auth',
    },
    setupInstructions: [
      { step: 1, title: 'Choose your credentials', description: 'Create a username and password for this webhook. These are not your Coupa login — choose any values you like.' },
      { step: 2, title: 'Open Coupa Notification Settings', description: 'Go to Setup → Notifications → Webhooks and click "New Webhook".' },
      { step: 3, title: 'Paste Baton Webhook URL', description: 'In the URL field, paste the Baton URL shown above.' },
      { step: 4, title: 'Enable Basic Authentication', description: 'Select "Basic" as the authentication type and enter the username and password from step 1.' },
    ],
    supportedEvents: [
      { eventType: 'purchase_order.created', label: 'PO Created', description: 'A new purchase order was created' },
      { eventType: 'purchase_order.updated', label: 'PO Updated', description: 'A purchase order was updated' },
      { eventType: 'purchase_order.approved', label: 'PO Approved', description: 'A purchase order was approved' },
      { eventType: 'invoice.created', label: 'Invoice Created', description: 'A new invoice was submitted' },
      { eventType: 'invoice.approved', label: 'Invoice Approved', description: 'An invoice was approved' },
      { eventType: 'supplier.created', label: 'Supplier Created', description: 'A new supplier was added' },
      { eventType: 'supplier.updated', label: 'Supplier Updated', description: 'A supplier record was updated' },
    ],
    webhookCapable: true,
  },

  servicenow: {
    slug: 'servicenow',
    name: 'ServiceNow',
    description: 'IT service management — incidents, change requests, service requests',
    logoUrl: '/assets/logos/servicenow.svg',
    category: 'IT Service',
    icon: '⚙️',
    secretKeyLabel: 'Basic Auth Credentials',
    secretKeyHint: 'Enter the username and password you will configure in ServiceNow',
    secretUsernameLabel: 'Basic Auth Username',
    secretPasswordLabel: 'Basic Auth Password',
    verificationMethod: {
      type: 'basic_auth',
    },
    setupInstructions: [
      { step: 1, title: 'Choose your credentials', description: 'Create a username and password for this webhook. These are not your ServiceNow login — choose any values you like.' },
      { step: 2, title: 'Open REST Messages', description: 'Go to System Web Services → Outbound → REST Messages and click "New".' },
      { step: 3, title: 'Configure the Outbound Message', description: 'Set the endpoint to the Baton URL shown above and select "Basic" as the authentication type.' },
      { step: 4, title: 'Set Credentials and Create Business Rule', description: 'Enter the username and password from step 1, then create a Business Rule to trigger the outbound message on the desired table events.' },
    ],
    supportedEvents: [
      { eventType: 'incident.created', label: 'Incident Created', description: 'A new incident was opened' },
      { eventType: 'incident.updated', label: 'Incident Updated', description: 'An incident was updated' },
      { eventType: 'incident.resolved', label: 'Incident Resolved', description: 'An incident was resolved' },
      { eventType: 'change_request.created', label: 'Change Request Created', description: 'A new change request was submitted' },
      { eventType: 'change_request.approved', label: 'Change Request Approved', description: 'A change request was approved' },
      { eventType: 'service_request.created', label: 'Service Request Created', description: 'A new service request was submitted' },
      { eventType: 'problem.created', label: 'Problem Created', description: 'A new problem record was created' },
    ],
    webhookCapable: true,
  },

  greenhouse: {
    slug: 'greenhouse',
    name: 'Greenhouse',
    description: 'Talent acquisition — candidates, applications, jobs, interviews, offers',
    logoUrl: '/assets/logos/greenhouse.svg',
    category: 'HR / Recruiting',
    icon: '🌱',
    secretKeyLabel: 'Secret Key',
    secretKeyHint: 'Paste the Secret Key from your Greenhouse web hook configuration',
    verificationMethod: {
      type: 'hmac_sha256',
      headerName: 'signature',
      encoding: 'base64',
    },
    setupInstructions: [
      { step: 1, title: 'Open Greenhouse Dev Center', description: 'Go to Settings → Dev Center → Web Hooks and click "Create".' },
      { step: 2, title: 'Paste Baton Webhook URL', description: 'In the "When" section choose the event and set the "Endpoint URL" to the Baton URL shown above.' },
      { step: 3, title: 'Copy the Secret Key', description: 'Copy the Secret Key generated by Greenhouse for this webhook.' },
      { step: 4, title: 'Paste the Secret Key', description: 'Paste the Secret Key below. Baton uses it to verify all incoming payloads.' },
    ],
    supportedEvents: [
      { eventType: 'candidate.created', label: 'Candidate Created', description: 'A new candidate profile was created' },
      { eventType: 'candidate.updated', label: 'Candidate Updated', description: 'A candidate profile was updated' },
      { eventType: 'application.created', label: 'Application Created', description: 'A new job application was submitted' },
      { eventType: 'application.updated', label: 'Application Updated', description: 'An application was updated' },
      { eventType: 'offer.created', label: 'Offer Created', description: 'An offer was extended to a candidate' },
      { eventType: 'interview.created', label: 'Interview Scheduled', description: 'An interview was scheduled' },
      { eventType: 'job.created', label: 'Job Created', description: 'A new job opening was created' },
      { eventType: 'hire.created', label: 'Candidate Hired', description: 'A candidate was marked as hired' },
    ],
    webhookCapable: true,
  },
  mondaycom: {
    slug: 'mondaycom',
    name: 'monday.com',
    description: 'Work OS — boards, items, automations, dashboards',
    logoUrl: '/assets/logos/mondaycom.svg',
    category: 'Project Management',
    icon: '📅',
    secretKeyLabel: 'No secret required',
    secretKeyHint: 'monday.com does not sign webhook payloads — no secret needed',
    verificationMethod: {
      type: 'none',
    },
    setupInstructions: [
      { step: 1, title: 'Open monday.com Admin', description: 'Go to your monday.com account and click on your avatar → Admin.' },
      { step: 2, title: 'Navigate to Integrations', description: 'In the Admin panel, go to Integrations → Webhooks and click "Add Webhook".' },
      { step: 3, title: 'Paste Baton Webhook URL', description: 'Enter the Baton URL shown above as the endpoint URL.' },
      { step: 4, title: 'Select Events and Save', description: 'Choose the board events you want to receive (e.g., item created, status changed) and save.' },
    ],
    supportedEvents: [
      { eventType: 'item.created', label: 'Item Created', description: 'A new item was created on a board' },
      { eventType: 'item.updated', label: 'Item Updated', description: 'An item was updated' },
      { eventType: 'item.deleted', label: 'Item Deleted', description: 'An item was deleted' },
      { eventType: 'item.status_changed', label: 'Status Changed', description: 'An item status column changed' },
      { eventType: 'subitem.created', label: 'Subitem Created', description: 'A new subitem was created' },
      { eventType: 'column.updated', label: 'Column Value Updated', description: 'A column value was changed on an item' },
      { eventType: 'update.created', label: 'Update Posted', description: 'An update (comment) was posted on an item' },
    ],
    webhookCapable: true,
  },

  middesk: {
    slug: 'middesk',
    name: 'Middesk',
    description: 'Business verification — KYB, entity data, watchlist screening, TIN matching',
    logoUrl: '/assets/logos/middesk.svg',
    category: 'Compliance',
    icon: '🔍',
    secretKeyLabel: 'Webhook Secret',
    secretKeyHint: 'Paste the webhook secret from your Middesk Dashboard → Developers → Webhooks',
    verificationMethod: {
      type: 'hmac_sha256',
      headerName: 'x-middesk-signature',
      encoding: 'hex',
    },
    setupInstructions: [
      { step: 1, title: 'Open Middesk Dashboard', description: 'Log in to app.middesk.com and go to Developers → Webhooks.' },
      { step: 2, title: 'Create a New Endpoint', description: 'Click "Add endpoint" and paste the Baton URL shown above.' },
      { step: 3, title: 'Select Events', description: 'Choose the business events you want to receive (e.g., business.approved, business.updated).' },
      { step: 4, title: 'Copy the Webhook Secret', description: 'Copy the signing secret shown for your endpoint and paste it below.' },
    ],
    supportedEvents: [
      { eventType: 'business.created', label: 'Business Created', description: 'A new business verification was initiated' },
      { eventType: 'business.updated', label: 'Business Updated', description: 'Business verification data was updated' },
      { eventType: 'business.approved', label: 'Business Approved', description: 'A business passed verification' },
      { eventType: 'business.declined', label: 'Business Declined', description: 'A business failed verification' },
      { eventType: 'business.in_review', label: 'Business In Review', description: 'A business is under manual review' },
      { eventType: 'business.pending', label: 'Business Pending', description: 'Business verification is pending' },
    ],
    webhookCapable: true,
  }, */

  bamboohr: {
    slug: 'bamboohr',
    name: 'BambooHR',
    description: 'HR platform — employees, time-off, onboarding, performance, org chart',
    logoUrl: '/assets/logos/bamboohr.svg',
    category: 'HR',
    icon: '🎋',
    secretKeyLabel: 'Webhook Secret Key',
    secretKeyHint: 'Enter the secret key you will configure in BambooHR webhook settings',
    verificationMethod: {
      type: 'hmac_bamboohr',
      headerName: 'x-bamboohr-signature',
      encoding: 'hex',
    },
    setupInstructions: [
      { step: 1, title: 'Open BambooHR Webhooks', description: 'Log in to BambooHR, go to Settings → Webhooks and click "Add Webhook".' },
      { step: 2, title: 'Paste Baton Webhook URL', description: 'In the "POST URL" field, paste the Baton URL shown above.' },
      { step: 3, title: 'Set a Secret Key', description: 'Enter a Secret Key in the BambooHR form. Use the same value in the field below.' },
      { step: 4, title: 'Choose Events and Save', description: 'Select the employee events you want to receive (e.g., Employee Created, Employee Changed) and save.' },
    ],
    supportedEvents: [
      { eventType: 'employee.created', label: 'Employee Created', description: 'A new employee was added to BambooHR' },
      { eventType: 'employee.changed', label: 'Employee Changed', description: 'Employee data was updated (fields changed)' },
      { eventType: 'employee.*', label: 'All Employee Events', description: 'Any employee-related event' },
    ],
    webhookCapable: true,
  },

  /* procore: {
    slug: 'procore',
    name: 'Procore',
    description: 'Construction management — projects, submittals, RFIs, documents, budgets',
    logoUrl: '/assets/logos/procore.svg',
    category: 'Construction',
    icon: '🏗️',
    secretKeyLabel: 'No secret required',
    secretKeyHint: 'Procore does not sign webhook payloads — no secret needed',
    verificationMethod: {
      type: 'none',
    },
    setupInstructions: [
      { step: 1, title: 'Open Procore Company Settings', description: 'Log in to Procore and go to Company Settings → App Management → Webhooks.' },
      { step: 2, title: 'Create a New Webhook', description: 'Click "Create Webhook" and give it a descriptive name.' },
      { step: 3, title: 'Paste Baton Webhook URL', description: 'Set the Destination URL to the Baton URL shown above.' },
      { step: 4, title: 'Select Triggers and Save', description: 'Choose the resource triggers (e.g., RFI created, Submittal updated) and save the webhook.' },
    ],
    supportedEvents: [
      { eventType: 'project.created', label: 'Project Created', description: 'A new project was created' },
      { eventType: 'project.updated', label: 'Project Updated', description: 'A project was updated' },
      { eventType: 'rfi.created', label: 'RFI Created', description: 'A new RFI was submitted' },
      { eventType: 'rfi.updated', label: 'RFI Updated', description: 'An RFI was updated' },
      { eventType: 'submittal.created', label: 'Submittal Created', description: 'A new submittal was created' },
      { eventType: 'submittal.updated', label: 'Submittal Updated', description: 'A submittal was updated' },
      { eventType: 'document.created', label: 'Document Uploaded', description: 'A new document was uploaded' },
      { eventType: 'budget.updated', label: 'Budget Updated', description: 'A budget line item was updated' },
      { eventType: 'punch_item.created', label: 'Punch Item Created', description: 'A new punch list item was created' },
    ],
    webhookCapable: true,
  }, */

};

// ─── Old platforms (commented out for demo) ─────────────────
// procore, xero, bamboohr, smartsheet templates were here — kept in git history

// ─── Helpers ──────────────────────────────────────────────────

export function getAppTemplate(slug: string): AppTemplate | undefined {
  return APP_TEMPLATES[slug as AppSlug];
}

export function getAllAppTemplates(): AppTemplate[] {
  return Object.values(APP_TEMPLATES);
}

// Legacy compat — still used by old routes that haven't been updated
export { getAppTemplate as getAppBySlug, getAllAppTemplates as getAllApps };
export type { AppTemplate as AppDefinition };
