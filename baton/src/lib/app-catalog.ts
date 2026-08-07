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
    description: 'CRM platform - leads, opportunities, contacts, accounts',
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
    description: 'CRM and marketing - contacts, deals, companies',
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
      { step: 4, title: 'Copy the Client Secret', description: 'Go to App Credentials tab and copy the Client Secret - paste it below.' },
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
    description: 'Customer relationship management - deals, contacts, leads',
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
      { step: 1, title: 'Choose your credentials', description: 'Create a username and password for this webhook. These are not your Zoho login - choose any values you like.' },
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
    description: 'Automate Microsoft 365 & Dataverse - flows push events into Baton via the HTTP action',
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
      { step: 1, title: 'Choose your credentials', description: 'Create a username and password for this webhook. These are not your Microsoft login - choose any values you like (use a long random password).' },
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

  // Airtable ships as webhook-only via Airtable Automations + Run a script
  // (Option A). The scripting environment has no crypto primitives, so the
  // auth is a static shared token compared timing-safe - NOT the native
  // Webhooks API MAC (that thin-ping + payloads-fetch + 7-day-refresh model
  // is the future full-connector upgrade).
  airtable: {
    slug: 'airtable',
    name: 'Airtable',
    description: 'Collaborative database - automations push record events into Baton via Run a script',
    logoUrl: '/assets/logos/airtable.svg',
    category: 'Database',
    icon: '🗃️',
    secretKeyLabel: 'Webhook Token',
    secretKeyHint: 'Choose a long random token - your automation script sends it in the X-Baton-Token header',
    verificationMethod: {
      type: 'static_token',
      headerName: 'X-Baton-Token',
    },
    setupInstructions: [
      { step: 1, title: 'Choose a token', description: 'Create a long random token for this webhook (a password generator works well). Paste it below - the same value goes into your script in step 4.' },
      { step: 2, title: 'Create an Airtable Automation', description: 'In your base, open Automations and add a trigger such as "When record created" or "When record matches conditions", then add a "Run a script" action.' },
      { step: 3, title: 'Pass record fields into the script', description: 'In the script action, add input variables for the fields you want to send (e.g. recordId from Record ID, plus any columns your workflow needs).' },
      { step: 4, title: 'Send the event to Baton', description: 'Paste a fetch call into the script: POST to the Baton URL shown above with headers Content-Type: application/json and X-Baton-Token: your token from step 1, and a JSON body with at least "event" and "recordId". Turn the automation on.', screenshotHint: '{ "event": "record.created", "recordId": "recXXXXXXXX", "data": { "Name": "...", "Email": "..." } }' },
    ],
    supportedEvents: [
      { eventType: 'record.created', label: 'Record Created', description: 'A new record was created in a table' },
      { eventType: 'record.updated', label: 'Record Updated', description: 'A record was updated' },
      { eventType: 'record.matches_conditions', label: 'Record Matches Conditions', description: 'A record entered a view or matched the automation conditions' },
      { eventType: 'form.submitted', label: 'Form Submitted', description: 'An Airtable form response created a record' },
      { eventType: '*', label: 'Any Event', description: 'Match any event string sent by the automation' },
    ],
    webhookCapable: true,
  },


  smartsheet: {
    slug: 'smartsheet',
    name: 'Smartsheet',
    description: 'Work management - sheets, rows, attachments, automation',
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
  },

  // ─── New platforms ────────────────────────────────────────────

  zendesk: {
    slug: 'zendesk',
    name: 'Zendesk',
    description: 'Customer support - tickets, users, organizations, satisfaction ratings',
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
      { step: 3, title: 'Configure the endpoint', description: 'Set the Endpoint URL to the Baton URL shown above, Request method to POST, and Request format to JSON. Set Authentication to "None" - Baton verifies authenticity using the signing secret below, not an auth header.' },
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

  greenhouse: {
    slug: 'greenhouse',
    name: 'Greenhouse',
    description: 'Talent acquisition - candidates, applications, jobs, interviews, offers',
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
    description: 'Work OS - boards, items, automations, dashboards',
    logoUrl: '/assets/logos/mondaycom.svg',
    category: 'Project Management',
    icon: '📅',
    secretKeyLabel: 'No secret required',
    secretKeyHint: 'monday.com does not sign webhook payloads - no secret needed',
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


  bamboohr: {
    slug: 'bamboohr',
    name: 'BambooHR',
    description: 'HR platform - employees, time-off, onboarding, performance, org chart',
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

};


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
