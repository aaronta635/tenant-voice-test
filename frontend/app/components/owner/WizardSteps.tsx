const STEPS = ['Property Details', 'Photos & Description', 'Rental Terms'];

export default function WizardSteps({ current }: { current: number }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        {STEPS.map((step, index) => (
          <div
            key={step}
            className={`h-1.5 flex-1 rounded-full ${index <= current ? 'bg-primary' : 'bg-border'}`}
          />
        ))}
      </div>
      <p className="text-sm text-text-body">
        Step {current + 1} of {STEPS.length}: {STEPS[current]}
      </p>
    </div>
  );
}
