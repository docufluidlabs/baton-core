import { CreateOrganization } from '@clerk/clerk-react';

export default function CreateOrgPage() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <CreateOrganization
        afterCreateOrganizationUrl="/dashboard"
        skipInvitationScreen={false}
      />
    </div>
  );
}
