# Algorithms and data structures

---

## 1. Feature-flag evaluation (decision tree / first-match)

**Location:** `packages/sdk-js/src/engine.ts:44-120` (Python `sdks/python/flagship/engine.py:44-79`)

**Purpose:** Map `(dataset, flagKey, context, default)` → `EvalResult`.

**Input:** `ClientDataset`, flag key, `EvalContext` (`key` + attributes), default value.

**Output:** `value`, `variationIndex` (or null on error), `reason`, optional `flagVersion`.

**Algorithm:**

1. Missing flag → default, `ERROR/FLAG_NOT_FOUND`.
2. Recurse prerequisites with `seen` Set; cycle → `MALFORMED_FLAG`; missing/off/wrong variation → `offVariation`, `PREREQUISITE_FAILED`.
3. If `!flag.on` → off, `OFF`.
4. Scan `targets[]` for `context.key` membership → that variation, `TARGET_MATCH`.
5. For each rule: if **all** clauses match → `VariationOrRollout`, `RULE_MATCH`.
6. Else fallthrough.

**Clause match (`engine.ts:122-140`):** `segmentMatch` ORs segment keys; else get attribute (dotted path); if array, any context element × any rule value; else any rule value; then optional `negate`.

**Segment (`:142-161`):** exclude list → false; include → true; else rules (AND clauses); optional `weight` vs `bucket(segment.key, salt, bucketBy) < weight/100`.

**Why:** deterministic, testable, no IO.

**Complexity:** O(P + T + R·C·V + hash) per eval; P prerequisite depth.

**Edge cases:** empty rules; missing variation index; `attr` undefined (operators typically false); `seen` shared along prerequisite chain (a diamond dependency might skip — **inference:** `seen` prevents re-entry globally in that call, so a flag cannot be a prereq twice in one tree).

**Alternatives:** boolean AST; Rete; server eval.

---

## 2. Dotted attribute access

**Location:** `engine.ts:221-231`

Walk `path.split(".")` through objects. `key` special-cased. Time O(depth).

---

## 3. Clause operators

**Location:** `operators.ts:48-112`

Equality (`in` is **single-value equality**, not “value in array of context” — the OR of `values[]` is in the engine). String ops, `RegExp`, numeric coerce, semver parse `MAJOR.MINOR.PATCH[-pre]`, date `Date.parse` or epoch ms.

**Semver:** pre-release ranks below release (`operators.ts:22-26`). Unparseable → null → false.

**Why:** targeting without a plugin system.

**Edge:** JS `typeof true === 'boolean'` so boolean context won’t match numeric ops. Python `_to_number` rejects bool explicitly (`operators.py:8-9`).

**Regex ReDoS:** possible.

---

## 4. Stable rollout hashing (bucket)

**Location:** `packages/sdk-js/src/hash.ts:17-29`, `sdks/python/flagship/hashing.py:8-18`

```text
hashInput = [seed + "."] + key + "." + salt + "." + bucketBy
hex = SHA1(hashInput)[0:15]
point = int(hex, 16) / 0xFFFFFFFFFFFFFFF   # 60 bits
```

**Output:** float in `[0, 1)` (theoretically `== 1` only if hex all F; tests expect `< 1`).

**Why:** sticky percentages without per-user storage; salt decorrelates flags (`hash.ts:1-14`).

**Time:** O(length of input) SHA-1.

**Space:** O(1).

**Edge:** Unicode — JS `createHash('sha1').update(string)` UTF-8; Python `.encode("utf-8")`. Should match.

**Tests:** uniformity 20k keys; stickiness (`hash.test.ts`).

**Alternatives:** murmur3 (LaunchDarkly historically), siphash, storing assignments.

**Crypto note:** SHA-1 is not used for security here.

JS uses `BigInt` then `Number` division — 60 bits fits exactly in IEEE mantissa (52 bits)? **60 > 52**, so **low bits of the 60-bit integer can be lost** when converting to Number. Python uses Python int / int → float (53-bit mantissa). **Possible tiny JS/Python divergence** for some hashes. **Not proven by a cross-language test in repo.** Architecture doc claims identical formula.

---

## 5. Weighted variation pick

**Location:** `hash.ts:36-50`, `hashing.py:21-28`

Cumulative `weight/100`; first bucket with `point < sum`. Remainder → last variation.

**JS extra:** returns `{ variation, inExperiment: false }` always. Engine spreads `inExperiment` into reason (`engine.ts:175-178`) so it is **always false**.

Python `pick_variation` returns **int only** — no inExperiment.

**Time:** O(number of weighted variations), typically 2.

---

## 6. Dataset version

**Location:** `backend/src/dataset/dataset.service.ts`

The environment integer **includes flag-config versions and segment versions**. `Segment.version` defaults to 1 and increments by 1 on segment update, so editing rules, includes, or excludes changes the number SDKs compare. Creating a segment adds a new version term; deleting one removes it.

**Purpose:** change detector for SDKs. Clients ignore a strictly older dataset.

**Not** a Lamport clock. An earlier aggregate used flag versions plus `segments.length * 1_000_000` only, so an in-place segment edit did not move it. `Segment.version` is what makes those edits observable.

---

## 7. Two-proportion z-test + normal CDF

**Location:** `backend/src/experiments/stats.ts`

**normalCdf:** Abramowitz & Stegun approximation (`stats.ts:1-8`).

**twoProportionTest:** pooled p, SE, z = (p2-p1)/SE, two-sided p = `2*(1-Φ(|z|))`, relative uplift `(p2-p1)/p1`, significant if `p < 0.05`. Zero exposures → p=1.

**Why:** show A/B significance in UI.

**Complexity:** O(1) after counts.

**Edge:** peeking, multiple variants vs control without correction; p1=0 uplift 0.

**Alternatives:** chi-square, sequential tests, CUPED.

---

## 8. Experiment aggregation

**Location:** `experiments.service.ts:79-126`

`Map<variationIndex, { exposed: Set<string>, converted: Set<string>, valueSum }>`

Unique users per event type. Control index **0**.

**Time/space:** O(events).

**Dedup:** Set of contextKey — duplicate rows don’t double-count users.

---

## 9. Auth cache

`Map<string, { value, expires }>` TTL 30s — classic hash map cache of **successful** SDK-key lookups. No LRU (unbounded if many keys are used). No negative caching. Rotate does not delete entries; each API process has its own map.

---

## 10. In-process structures (SDK)

- `Set<ChangeListener>`
- `Engine | null`
- Python `threading.Event` + `Lock`

---

## 11. Serialization

`JSON.stringify` / `JSON.parse` for Redis and HTTP. No protobuf, no compression.

---

## 12. Encoding / IDs

- `cuid()` Prisma ids
- `nanoid(16)` salts
- `customAlphabet` 12-char sdk suffix (`projects.service.ts:6-9`)
- Seed **fixed** SDK keys for demo

---

## Not present

Trees (except eval is a tree of prereqs), heaps, tries, graphs (prereq is a DAG if acyclic), CRDTs, pagination algorithms, rate-limit tokens, schedulers, bloom filters, compression.
