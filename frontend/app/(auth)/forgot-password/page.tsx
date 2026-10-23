import ResetLinkRequest from '@/app/components/auth/ResetLinkRequest';

export const metadata = { title: 'Reset your password' };

export default function ForgotPasswordPage() {
  return (
    <ResetLinkRequest
      title="Reset your password"
      description="Enter the email you use for TenantVoice and we will send you a link to choose a new password."
    />
  );
}
