import DemoLabel from '@/app/components/demo/DemoLabel';

/** Housing surveys are prototypes: there is no response table, so nothing is sent and no answers come back. */
export default function SurveyPrototypeNotice({ className }: { className?: string }) {
  return (
    <DemoLabel
      variant="notice"
      className={className}
      reason="Prototype surveys: no survey is sent to anyone and no answers are collected yet. Response counts show what is stored, not real answers."
    />
  );
}
