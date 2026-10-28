"use client";

import { useEffect } from "react";
import type { Clause, ClauseOp, FlagValue, TargetingRule } from "@/lib/types";
import { CLAUSE_OPS, emptyRule, formatValueList, parseValueList, validateTargetingRules } from "@/lib/targeting";
import { Button, Field, Input, Select } from "@/components/ui";

/**
 * Audience rules: one clause per rule, either "attribute equals a value" or
 * "attribute ends with a value" (an email domain). First matching rule wins.
 */
export default function RuleBuilder({
  rules,
  onChange,
  variations,
  onValidity,
}: {
  rules: TargetingRule[];
  onChange: (rules: TargetingRule[]) => void;
  variations: FlagValue[];
  onValidity?: (error: string | null) => void;
}) {
  const error = validateTargetingRules(rules);

  useEffect(() => {
    onValidity?.(error);
  }, [error, onValidity]);

  function updateRule(index: number, next: TargetingRule) {
    const copy = [...rules];
    copy[index] = next;
    onChange(copy);
  }

  function updateClause(index: number, rule: TargetingRule, patch: Partial<Clause>) {
    const clause = rule.clauses[0] ?? emptyRule().clauses[0];
    updateRule(index, { ...rule, clauses: [{ ...clause, ...patch }] });
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Audience rules</h3>
      <p className="text-xs text-muted-foreground">
        Match an attribute that equals a value, or an email that ends with a domain. First matching rule wins.
      </p>

      {rules.map((rule, ruleIndex) => {
        const clause = rule.clauses[0];
        return (
          <div key={rule.id} className="space-y-3 rounded-lg border border-border p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1.4fr]">
              <Field label="Attribute">
                <Input
                  value={clause?.attribute ?? ""}
                  aria-label={`Rule ${ruleIndex + 1} attribute`}
                  onChange={(event) => updateClause(ruleIndex, rule, { attribute: event.target.value })}
                />
              </Field>
              <Field label="Operator">
                <Select
                  value={clause?.op ?? "in"}
                  aria-label={`Rule ${ruleIndex + 1} operator`}
                  onChange={(event) => updateClause(ruleIndex, rule, { op: event.target.value as ClauseOp })}
                >
                  {CLAUSE_OPS.map((op) => (
                    <option key={op.value} value={op.value}>
                      {op.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Values" hint="Comma-separated; any one may match.">
                <Input
                  value={formatValueList(clause?.values)}
                  aria-label={`Rule ${ruleIndex + 1} values`}
                  onChange={(event) => updateClause(ruleIndex, rule, { values: parseValueList(event.target.value) })}
                />
              </Field>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Serve" className="min-w-[200px] flex-1">
                <Select
                  value={String(rule.variation ?? 0)}
                  aria-label={`Rule ${ruleIndex + 1} outcome`}
                  onChange={(event) =>
                    updateRule(ruleIndex, { ...rule, rollout: undefined, variation: Number(event.target.value) })
                  }
                >
                  {variations.map((value, index) => (
                    <option key={index} value={index}>
                      Variation {index}: {JSON.stringify(value)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button variant="ghost" size="sm" onClick={() => onChange(rules.filter((_, index) => index !== ruleIndex))}>
                Remove rule
              </Button>
            </div>
          </div>
        );
      })}
      {rules.length === 0 && (
        <p className="text-sm text-muted-foreground">No rules. Everyone who misses individual targets uses the default below.</p>
      )}
      <Button size="sm" variant="secondary" onClick={() => onChange([...rules, emptyRule()])}>
        Add rule
      </Button>
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
