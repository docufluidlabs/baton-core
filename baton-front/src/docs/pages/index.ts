import type { ComponentType } from 'react';
import Welcome from './welcome';
import HowItWorks from './how-it-works';
import Concepts from './concepts';
import QuickStart from './quick-start';
import ConnectDocusign from './connect-docusign';
import Connections from './connections';
import Salesforce from './salesforce';
import CustomWebhook from './custom-webhook';
import FlowBuilder from './flow-builder';
import Conditions from './conditions';
import BulkUpload from './bulk-upload';
import Workflows from './workflows';
import ControlCenter from './control-center';
import Logs from './logs';
import Notifications from './notifications';
import Settings from './settings';
import Verification from './verification';
import Catalog from './catalog';
import Troubleshooting from './troubleshooting';
import Glossary from './glossary';

export const DOC_COMPONENTS: Record<string, ComponentType> = {
  welcome: Welcome,
  'how-it-works': HowItWorks,
  concepts: Concepts,
  'quick-start': QuickStart,
  'connect-docusign': ConnectDocusign,
  connections: Connections,
  salesforce: Salesforce,
  'custom-webhook': CustomWebhook,
  'flow-builder': FlowBuilder,
  conditions: Conditions,
  'bulk-upload': BulkUpload,
  workflows: Workflows,
  'control-center': ControlCenter,
  logs: Logs,
  notifications: Notifications,
  settings: Settings,
  verification: Verification,
  catalog: Catalog,
  troubleshooting: Troubleshooting,
  glossary: Glossary,
};
