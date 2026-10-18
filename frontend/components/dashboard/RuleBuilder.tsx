"use client";

import { useEffect, useState } from "react";
import type { ClauseOp, FlagValue, TargetingRule } from "@/lib/types";
import {
  COMMON_OPS,
  emptyClause,
  emptyRule,
  formatValueList,
  parseValueList,
  validateTargetingRules,
} from "@/lib/targeting";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";

export default function RuleBuilder({
  rules,
  onChange,
  variations,
  segments,
  onValidity,
}: {
  rules: TargetingRule[];
  onChange: (rules: TargetingRule[]) => void;
  variations: FlagValue[];
  segments: { key: string; name: string }[];
  onValidity?: (error: string | null) => void;
}) {
  const [mode, setMode] = useState<"builder" | "json">("builder");
  const [jsonText, setJsonText] = useState(() => JSON.stringify(rules, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  useEffect(() => {
    if (mode === "builder") onValidity?.(validateTargetingRules(rules));
  }, [mode, rules, onValidity]);

  function update(next: TargetingRule[]) {
    onChange(next);
    setJsonText(JSON.stringify(next, null, 2));
    setJsonError(null);
  }

  function switchMode(next: "builder" | "json") {
    if (next === "json") {
      setJsonText(JSON.stringify(rules, null, 2));
      setJsonError(null);
      setMode("json");
      return;
    }
    try {
      const parsed = JSON.parse(jsonText) as TargetingRule[];
      const error = validateTargetingRules(parsed);
      if (error) {
        setJsonError(error);
        onValidity?.(error);
        return;
      }
      onChange(parsed);
      setJsonError(null);
      setMode("builder");
    } catch {
      setJsonError("JSON is invalid. Fix it before returning to the builder.");
      onValidity?.("Targeting JSON is invalid.");
    }
  }

  function applyJson(text: string) {
    setJsonText(text);
    try {
      const parsed = JSON.parse(text) as unknown;
      const error = validateTargetingRules(parsed);
      setJsonError(error);
      onValidity?.(error ?? null);
      if (!error) onChange(parsed as TargetingRule[]);
    } catch {
      const message = "Targeting JSON is invalid.";
      setJsonError(message);
      onValidity?.(message);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Targeting rules</h3>
        <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label="Rule editor mode">
          <button
            type="button"
            className={`rounded-md px-3 py-1 text-xs ${mode === "builder" ? "bg-primary text-primary-foreground" : ""}`}
            aria-pressed={mode === "builder"}
            onClick={() => switchMode("builder")}
          >
            Builder
          </button>
          <button
            type="button"
            className={`rounded-md px-3 py-1 text-xs ${mode === "json" ? "bg-primary text-primary-foreground" : ""}`}
            aria-pressed={mode === "json"}
            onClick={() => switchMode("json")}
          >
            Advanced JSON
          </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        First matching rule wins. Use the builder for common operators, or Advanced JSON for the full engine
        surface (semver, regex, dates).
      </p>

      {mode === "json" ? (
        <Field label="Rules JSON" error={jsonError}>
          <Textarea rows={12} value={jsonText} onChange={(event) => applyJson(event.target.value)} spellCheck={false} className="font-mono" />
        </Field>
      ) : (
        <div className="space-y-3">
          {rules.map((rule, ruleIndex) => (
            <div key={rule.id} className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Rule id" className="min-w-[140px] flex-1">
                  <Input
                    value={rule.id}
                    aria-label={`Rule ${ruleIndex + 1} id`}
                    onChange={(event) => {
                      const next = [...rules];
                      next[ruleIndex] = { ...rule, id: event.target.value };
                      update(next);
                    }}
                  />
                </Field>
                <Field label="Description" className="min-w-[180px] flex-[2]">
                  <Input
                    value={rule.description ?? ""}
                    aria-label={`Rule ${ruleIndex + 1} description`}
                    onChange={(event) => {
                      const next = [...rules];
                      next[ruleIndex] = { ...rule, description: event.target.value };
                      update(next);
                    }}
                  />
                </Field>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => update(rules.filter((_, index) => index !== ruleIndex))}
                >
                  Remove rule
                </Button>
              </div>

              {rule.clauses.map((clause, clauseIndex) => (
                <div key={clauseIndex} className="grid gap-2 sm:grid-cols-[1fr_1fr_1.4fr_auto]">
                  <Field label="Attribute">
                    <Input
                      value={clause.attribute}
                      disabled={clause.op === "segmentMatch"}
                      aria-label={`Rule ${ruleIndex + 1} clause ${clauseIndex + 1} attribute`}
                      onChange={(event) => {
                        const clauses = rule.clauses.slice();
                        clauses[clauseIndex] = { ...clause, attribute: event.target.value };
                        const next = [...rules];
                        next[ruleIndex] = { ...rule, clauses };
                        update(next);
                      }}
                    />
                  </Field>
                  <Field label="Operator">
                    <Select
                      value={clause.op}
                      aria-label={`Rule ${ruleIndex + 1} clause ${clauseIndex + 1} operator`}
                      onChange={(event) => {
                        const op = event.target.value as ClauseOp;
                        const clauses = rule.clauses.slice();
                        clauses[clauseIndex] = {
                          ...clause,
                          op,
                          attribute: op === "segmentMatch" ? "" : clause.attribute || "country",
                        };
                        const next = [...rules];
                        next[ruleIndex] = { ...rule, clauses };
                        update(next);
                      }}
                    >
                      {COMMON_OPS.map((op) => (
                        <option key={op.value} value={op.value}>
                          {op.label}
                        </option>
                      ))}
                      {!COMMON_OPS.some((op) => op.value === clause.op) && (
                        <option value={clause.op}>{clause.op}</option>
                      )}
                    </Select>
                  </Field>
                  <Field label={clause.op === "segmentMatch" ? "Segments" : "Values"}>
                    <Input
                      list={clause.op === "segmentMatch" ? "segment-keys" : undefined}
                      value={formatValueList(clause.values)}
                      aria-label={`Rule ${ruleIndex + 1} clause ${clauseIndex + 1} values`}
                      onChange={(event) => {
                        const clauses = rule.clauses.slice();
                        clauses[clauseIndex] = {
                          ...clause,
                          values: parseValueList(event.target.value, clause.op),
                        };
                        const next = [...rules];
                        next[ruleIndex] = { ...rule, clauses };
                        update(next);
                      }}
                    />
                  </Field>
                  <div className="flex items-end gap-2 pb-0.5">
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={!!clause.negate}
                        onChange={(event) => {
                          const clauses = rule.clauses.slice();
                          clauses[clauseIndex] = { ...clause, negate: event.target.checked || undefined };
                          const next = [...rules];
                          next[ruleIndex] = { ...rule, clauses };
                          update(next);
                        }}
                      />
                      not
                    </label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const clauses = rule.clauses.filter((_, index) => index !== clauseIndex);
                        const next = [...rules];
                        next[ruleIndex] = { ...rule, clauses: clauses.length ? clauses : [emptyClause()] };
                        update(next);
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const next = [...rules];
                  next[ruleIndex] = { ...rule, clauses: [...rule.clauses, emptyClause()] };
                  update(next);
                }}
              >
                Add clause
              </Button>

              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Serve">
                  <Select
                    value={rule.rollout ? "rollout" : String(rule.variation ?? 0)}
                    aria-label={`Rule ${ruleIndex + 1} outcome`}
                    onChange={(event) => {
                      const next = [...rules];
                      if (event.target.value === "rollout") {
                        next[ruleIndex] = {
                          ...rule,
                          variation: undefined,
                          rollout: {
                            variations: variations.map((_, index) => ({
                              variation: index,
                              weight: index === 0 ? 100 : 0,
                            })),
                          },
                        };
                      } else {
                        next[ruleIndex] = {
                          ...rule,
                          rollout: undefined,
                          variation: Number(event.target.value),
                        };
                      }
                      update(next);
                    }}
                  >
                    {variations.map((value, index) => (
                      <option key={index} value={index}>
                        Variation {index}: {JSON.stringify(value)}
                      </option>
                    ))}
                    <option value="rollout">Percentage rollout</option>
                  </Select>
                </Field>
                {rule.rollout && (
                  <div className="flex flex-wrap items-end gap-2">
                    {variations.map((value, index) => (
                      <Field key={index} label={`Var ${index} %`}>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          className="w-24"
                          value={rule.rollout?.variations.find((item) => item.variation === index)?.weight ?? 0}
                          aria-label={`Rule ${ruleIndex + 1} variation ${index} weight`}
                          onChange={(event) => {
                            const weight = Number(event.target.value);
                            const variationsWeights = variations.map((_, variation) => ({
                              variation,
                              weight:
                                variation === index
                                  ? weight
                                  : rule.rollout?.variations.find((item) => item.variation === variation)?.weight ?? 0,
                            }));
                            const next = [...rules];
                            next[ruleIndex] = {
                              ...rule,
                              variation: undefined,
                              rollout: { ...rule.rollout, variations: variationsWeights },
                            };
                            update(next);
                          }}
                        />
                      </Field>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {rules.length === 0 && (
            <p className="text-sm text-muted-foreground">No rules. Everyone who misses individual targets uses the default below.</p>
          )}
          <Button size="sm" variant="secondary" onClick={() => update([...rules, emptyRule()])}>
            Add rule
          </Button>
          {validateTargetingRules(rules) && (
            <p className="text-xs text-red-600" role="alert">
              {validateTargetingRules(rules)}
            </p>
          )}
          <datalist id="segment-keys">
            {segments.map((segment) => (
              <option key={segment.key} value={segment.key}>
                {segment.name}
              </option>
            ))}
          </datalist>
        </div>
      )}
    </section>
  );
}
