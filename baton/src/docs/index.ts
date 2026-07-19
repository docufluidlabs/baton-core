import './registry';
import './security';
import './components';

// Schemas (registration side-effects)
import './schemas/common';
import './schemas/workflow';
import './schemas/instance';
import './schemas/webhook-endpoint';
import './schemas/connection';
import './schemas/automation';
import './schemas/platform';
import './schemas/settings';
import './schemas/slack';
import './schemas/salesforce';
import './schemas/inbound';

// Route registrations
import './routes/health.docs';
import './routes/inbound-webhooks.docs';
import './routes/workflows.docs';
import './routes/webhook-endpoints.docs';
import './routes/connections.docs';
import './routes/automations.docs';
import './routes/platforms.docs';
import './routes/settings.docs';
import './routes/slack.docs';
import './routes/flow-layout.docs';
import './routes/salesforce.docs';
import './routes/errors.docs';
import './routes/auth.docs';
import './routes/instances.docs';
import './routes/events.docs';
import './routes/dashboard.docs';
import './routes/notifications.docs';
import './routes/user-activity.docs';
import './routes/support.docs';

export { buildOpenApiDocument } from './generator';
export { registry } from './registry';
