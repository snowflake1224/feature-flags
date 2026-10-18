"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  COMMON_OPS,
  emptySegmentRule,
  parseContextList,
  slugKey,
  validateFlagKey,
  validateSegmentRules,
} from "@/lib/targeting";
import type { Clause, ClauseOp, Segment, SegmentRule } from "@/lib/types";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, Select, Skeleton, Textarea } from "@/components/ui";

interface Draft {
  key: string;
  name: string;
  description: string;
  included: string;
  excluded: string;
  rules: SegmentRule[];
  jsonMode: boolean;
  jsonText: string;
  keyTouched: boolean;
}

function blankDraft(): Draft {
  return {
    key: "",
    name: "",
    description: "",
    included: "",
    excluded: "",
    rules: [],
    jsonMode: false,
    jsonText: "[]",
    keyTouched: false,
  };
}

function fromSegment(segment: Segment): Draft {
  const rules = Array.isArray(segment.rules) && segment.rules.length ? segment.rules : [];
  return {
    key: segment.key,
    name: segment.name,
    description: segment.description ?? "",
    included: (segment.included ?? []).join("\n"),
    excluded: (segment.excluded ?? []).join("\n"),
    rules,
    jsonMode: false,
    jsonText: JSON.stringify(rules, null, 2),
    keyTouched: true,
  };
}

export default function SegmentsTab({
  projectId,
  envId,
  production,
  envName,
}: {
  projectId: string;
  envId: string;
  production: boolean;
  envName: string;
}) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Segment | null>(null);

  const load = useCallback(() => {
    if (!envId) return;
    setLoading(true);
    api
      .listSegments(projectId, envId)
      .then((next) => {
        setSegments(next);
        setError(null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId, envId]);

  useEffect(() => {
    load();
  }, [load]);

  function rulesFromDraft(current: Draft): { rules: SegmentRule[] | null; error: string | null } {
    if (!current.jsonMode) {
      const errorMessage = validateSegmentRules(current.rules);
      return { rules: errorMessage ? null : current.rules, error: errorMessage };
    }
    try {
      const parsed = JSON.parse(current.jsonText) as unknown;
      const errorMessage = validateSegmentRules(parsed);
      return { rules: errorMessage ? null : (parsed as SegmentRule[]), error: errorMessage };
    } catch {
      return { rules: null, error: "Rules JSON is invalid." };
    }
  }

  async function save() {
    if (!draft) return;
    const keyError = validateFlagKey(draft.key);
    if (keyError || !draft.name.trim()) {
      setFormError(keyError ?? "Name is required.");
      return;
    }
    const parsed = rulesFromDraft(draft);
    if (!parsed.rules) {
      setFormError(parsed.error);
      return;
    }
    setBusy(true);
    setFormError(null);
    const body = {
      key: draft.key.trim(),
      name: draft.name.trim(),
      description: draft.description.trim(),
      included: parseContextList(draft.included),
      excluded: parseContextList(draft.excluded),
      rules: parsed.rules,
    };
    try {
      if (editingKey) {
        await api.updateSegment(projectId, envId, editingKey, body);
        setNotice(`Updated ${editingKey}.`);
      } else {
        await api.createSegment(projectId, envId, body);
        setNotice(`Created ${body.key}.`);
      }
      setDraft(null);
      setEditingKey(null);
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(segment: Segment) {
    setBusy(true);
    setError(null);
    try {
      await api.deleteSegment(projectId, envId, segment.key);
      setNotice(`Deleted ${segment.key}.`);
      setPendingDelete(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          Segments are reusable cohorts for {envName}. Flags reference them with a <code>segmentMatch</code> clause.
        </p>
        <Button
          size="sm"
          onClick={() => {
            setEditingKey(null);
            setFormError(null);
            setDraft(blankDraft());
          }}
        >
          New segment
        </Button>
      </div>
      {notice && (
        <Alert tone="success" onDismiss={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2" aria-busy="true" aria-label="Loading segments">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : segments.length === 0 ? (
        <EmptyState title="No segments in this environment">
          Add included keys such as user-beta-1, or a rule on email domain, then target the segment from a flag.
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {segments.map((segment) => (
            <Card key={segment.id}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{segment.name}</div>
                  <Badge color="blue">{segment.key}</Badge>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditingKey(segment.key);
                      setFormError(null);
                      setDraft(fromSegment(segment));
                    }}
                  >
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPendingDelete(segment)}>
                    Delete
                  </Button>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{segment.description || "No description"}</p>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>{segment.included?.length ?? 0} included</span>
                <span>{segment.excluded?.length ?? 0} excluded</span>
                <span>{(segment.rules ?? []).length} rules</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={!!draft}
        title={editingKey ? `Edit ${editingKey}` : "New segment"}
        description={production ? `${envName} is production. Saving refreshes the dataset.` : `Saved on ${envName}.`}
        onClose={() => setDraft(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? "Saving…" : editingKey ? "Save segment" : "Create segment"}
            </Button>
          </>
        }
      >
        {draft && (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" htmlFor="segment-name">
                <Input
                  id="segment-name"
                  value={draft.name}
                  onChange={(event) => {
                    const name = event.target.value;
                    setDraft({
                      ...draft,
                      name,
                      key: editingKey || draft.keyTouched ? draft.key : slugKey(name),
                    });
                  }}
                />
              </Field>
              <Field label="Key" htmlFor="segment-key" error={formError}>
                <Input
                  id="segment-key"
                  value={draft.key}
                  disabled={!!editingKey}
                  aria-invalid={!!formError}
                  onChange={(event) => setDraft({ ...draft, key: event.target.value, keyTouched: true })}
                />
              </Field>
            </div>
            <Field label="Description" htmlFor="segment-description">
              <Input
                id="segment-description"
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </Field>
            <Field label="Included keys" htmlFor="segment-included" hint="Comma or newline separated. These contexts always match.">
              <Textarea
                id="segment-included"
                rows={3}
                className="font-sans"
                value={draft.included}
                onChange={(event) => setDraft({ ...draft, included: event.target.value })}
              />
            </Field>
            <Field label="Excluded keys" htmlFor="segment-excluded" hint="Excluded keys never match, even if a rule would include them.">
              <Textarea
                id="segment-excluded"
                rows={2}
                className="font-sans"
                value={draft.excluded}
                onChange={(event) => setDraft({ ...draft, excluded: event.target.value })}
              />
            </Field>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Rules</h3>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (draft.jsonMode) {
                    try {
                      const parsed = JSON.parse(draft.jsonText) as SegmentRule[];
                      const errorMessage = validateSegmentRules(parsed);
                      if (errorMessage) {
                        setFormError(errorMessage);
                        return;
                      }
                      setDraft({ ...draft, rules: parsed, jsonMode: false });
                      setFormError(null);
                    } catch {
                      setFormError("Rules JSON is invalid.");
                    }
                  } else {
                    setDraft({ ...draft, jsonMode: true, jsonText: JSON.stringify(draft.rules, null, 2) });
                  }
                }}
              >
                {draft.jsonMode ? "Use builder" : "Advanced JSON"}
              </Button>
            </div>
            {draft.jsonMode ? (
              <Textarea
                rows={8}
                className="font-mono"
                aria-label="Segment rules JSON"
                value={draft.jsonText}
                onChange={(event) => setDraft({ ...draft, jsonText: event.target.value })}
              />
            ) : (
              <div className="space-y-3">
                {draft.rules.map((rule, index) => (
                  <SegmentRuleFields
                    key={index}
                    rule={rule}
                    onChange={(next) => {
                      const rules = draft.rules.slice();
                      rules[index] = next;
                      setDraft({ ...draft, rules });
                    }}
                    onRemove={() => setDraft({ ...draft, rules: draft.rules.filter((_, i) => i !== index) })}
                  />
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDraft({ ...draft, rules: [...draft.rules, emptySegmentRule()] })}
                >
                  Add rule
                </Button>
              </div>
            )}
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={!!pendingDelete}
        title={pendingDelete ? `Delete ${pendingDelete.name}?` : "Delete segment"}
        description={
          production
            ? "Flags in production that match this segment will stop matching after the dataset refreshes."
            : "Flags that reference this segment will stop matching it."
        }
        confirmLabel="Delete segment"
        danger
        busy={busy}
        onConfirm={() => pendingDelete && void remove(pendingDelete)}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}

function SegmentRuleFields({
  rule,
  onChange,
  onRemove,
}: {
  rule: SegmentRule;
  onChange: (rule: SegmentRule) => void;
  onRemove: () => void;
}) {
  const clause = rule.clauses[0] ?? { attribute: "email", op: "endsWith" as const, values: [] };
  function writeClause(next: Clause) {
    const clauses = rule.clauses.length ? rule.clauses.slice() : [next];
    clauses[0] = next;
    onChange({ ...rule, clauses });
  }
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      {rule.clauses.length > 1 && (
        <p className="text-xs text-muted-foreground">
          This rule has {rule.clauses.length} clauses. The builder edits the first one and keeps the rest. Use Advanced JSON to edit all of them.
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Attribute">
          <Input value={clause.attribute} onChange={(event) => writeClause({ ...clause, attribute: event.target.value })} />
        </Field>
        <Field label="Operator">
          <Select
            value={clause.op}
            onChange={(event) => writeClause({ ...clause, op: event.target.value as ClauseOp })}
          >
            {COMMON_OPS.map((op) => (
              <option key={op.value} value={op.value}>
                {op.label}
              </option>
            ))}
            {!COMMON_OPS.some((op) => op.value === clause.op) && <option value={clause.op}>{clause.op}</option>}
          </Select>
        </Field>
        <Field label="Values">
          <Input
            value={(clause.values ?? []).join(", ")}
            onChange={(event) =>
              writeClause({
                ...clause,
                values: event.target.value
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>
      </div>
      <div className="flex items-end gap-2">
        <Field label="Include percent" hint="Blank means everyone who matches." className="w-40">
          <Input
            type="number"
            min={0}
            max={100}
            value={rule.weight ?? ""}
            onChange={(event) => {
              const raw = event.target.value;
              onChange({ ...rule, weight: raw === "" ? undefined : Number(raw) });
            }}
          />
        </Field>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          Remove rule
        </Button>
      </div>
    </div>
  );
}
