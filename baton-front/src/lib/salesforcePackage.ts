/**
 * Salesforce managed package — install metadata.
 *
 * Single source of truth for the current "Baton for Salesforce" package version
 * and its subscriber-package-version id (`04t…`). When a new package version is
 * promoted, bump these two values here and everywhere in the app updates: the
 * Salesforce Setup page install button, the copy-able install URL, etc.
 *
 * The id mirrors `packageAliases["Baton@<version>"]` in
 * sf-managed-package-baton/sfdx-project.json.
 */

/** Human-readable version shown in the UI, e.g. on the install badge. */
export const SF_PACKAGE_VERSION = '0.8.0';

/** Subscriber Package Version Id (04t…) for the current release. */
export const SF_PACKAGE_VERSION_ID = '04tdM000000UD6HQAW';

/** Permission set bundled with the package, assigned to every dispatching user. */
export const SF_PERMISSION_SET = 'Baton User';

/** Baton production host the package is pre-authorized to call (Remote Site Setting). */
export const SF_BATON_HOST = 'https://app.iambaton.com';

export type SfOrgEnv = 'production' | 'sandbox';

/**
 * Build the Salesforce package install URL. Production orgs install from
 * login.salesforce.com; sandboxes from test.salesforce.com. Admins open this
 * while logged into the target org and pick "Install for Admins Only".
 */
export function sfInstallUrl(env: SfOrgEnv = 'production'): string {
  const host = env === 'sandbox' ? 'test.salesforce.com' : 'login.salesforce.com';
  return `https://${host}/packaging/installPackage.apexp?p0=${SF_PACKAGE_VERSION_ID}`;
}
