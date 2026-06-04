'use client';

import { useState } from 'react';
import WorkflowStepCard from './WorkflowStepCard.jsx';
import WorkflowStepTypePicker from './WorkflowStepTypePicker.jsx';
import { buildWorkflowVariableGroups, createDefaultWorkflowStep, sanitizeExecutableSteps } from '../lib/workflowStepFormModel.js';
import { buildWorkflowResourceLookups } from '../lib/workflowBuilderResources.js';

export default function WorkflowStepBuilder({ steps, onChange, resourceOptions }) {
  const normalizedSteps = sanitizeExecutableSteps(steps);
  const hasSteps = normalizedSteps.length > 0;
  const [showEmptyStatePicker, setShowEmptyStatePicker] = useState(false);
  const resourceLookups = buildWorkflowResourceLookups(resourceOptions);

  function updateSteps(nextSteps) {
    onChange(sanitizeExecutableSteps(nextSteps));
  }

  function addStep(type) {
    const nextStep = createDefaultWorkflowStep(type, normalizedSteps.length + 1);
    setShowEmptyStatePicker(false);
    updateSteps([...normalizedSteps, nextStep]);
  }

  function replaceStep(stepIndex, nextStep) {
    const nextSteps = [...normalizedSteps];
    nextSteps[stepIndex] = nextStep;
    updateSteps(nextSteps);
  }

  function moveStep(stepIndex, direction) {
    const targetIndex = stepIndex + direction;
    if (targetIndex < 0 || targetIndex >= normalizedSteps.length) return;
    const nextSteps = [...normalizedSteps];
    const [step] = nextSteps.splice(stepIndex, 1);
    nextSteps.splice(targetIndex, 0, step);
    updateSteps(nextSteps);
  }

  function duplicateStep(stepIndex) {
    const step = normalizedSteps[stepIndex];
    const duplicate = {
      ...step,
      id: `step_${normalizedSteps.length + 1}`,
      name: `${step.name} copy`,
      config: JSON.parse(JSON.stringify(step.config)),
    };
    updateSteps([
      ...normalizedSteps.slice(0, stepIndex + 1),
      duplicate,
      ...normalizedSteps.slice(stepIndex + 1),
    ]);
  }

  function deleteStep(stepIndex) {
    updateSteps(normalizedSteps.filter((_, index) => index !== stepIndex));
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-white/[0.02] p-4">
        <div className="text-sm font-medium text-white">Executable workflow steps</div>
        <p className="mt-2 text-sm text-secondary">
          Workflows currently run steps in order. Later steps can use outputs from earlier steps, but this version does not support branching or graph logic.
        </p>
      </div>

      {!hasSteps ? (
        <div className="rounded-xl border border-dashed border-border bg-white/[0.02] p-5 space-y-4">
          <div>
            <div className="text-sm font-medium text-white">No executable steps yet</div>
            <p className="mt-1 text-sm text-secondary">Start by adding the first real runtime step for this workflow.</p>
          </div>
          <button
            type="button"
            onClick={() => setShowEmptyStatePicker(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand/90 transition-colors"
          >
            Add first step
          </button>
          {showEmptyStatePicker && <WorkflowStepTypePicker onSelect={addStep} />}
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {normalizedSteps.map((step, index) => (
              <WorkflowStepCard
                key={step.id}
                step={step}
                index={index}
                total={normalizedSteps.length}
                resourceOptions={resourceOptions}
                resourceLookups={resourceLookups}
                variableGroups={buildWorkflowVariableGroups(normalizedSteps, index)}
                onChange={(nextStep) => replaceStep(index, nextStep)}
                onDuplicate={() => duplicateStep(index)}
                onDelete={() => deleteStep(index)}
                onMoveUp={() => moveStep(index, -1)}
                onMoveDown={() => moveStep(index, 1)}
              />
            ))}
          </div>

          <div className="rounded-xl border border-border bg-white/[0.02] p-4">
            <div className="text-xs font-medium text-secondary uppercase tracking-wider mb-3">Add another step</div>
            <WorkflowStepTypePicker onSelect={addStep} />
          </div>
        </>
      )}
    </div>
  );
}
