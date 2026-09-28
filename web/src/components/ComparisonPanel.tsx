"use client";

import { explainPair, pct, times } from "@/lib/explain";
import type { Comparison } from "@/lib/pairing";
import { regionTitle, type Region } from "@/lib/regions";
import type { RegionScore } from "@/lib/scoring";

type Props = {
  regionsA: Region[];
  regionsB: Region[];
  comparison: Comparison;
  scoresA: Map<string, RegionScore> | null;
  scoresB: Map<string, RegionScore> | null;
  onChoose: (regionAId: string, regionBId: string | null) => void;
  onExport: () => void;
};

export function ComparisonPanel(props: Props) {
  const { regionsA, regionsB, comparison, scoresA, scoresB } = props;
  const pairOf = new Map(comparison.pairs.map((p) => [p.a.id, p]));
  const usedB = new Set(comparison.pairs.map((p) => p.b.id));
  const ready = scoresA !== null && scoresB !== null;

  return (
    <section className="comparison" aria-labelledby="comparison-title">
      <h2 id="comparison-title">Compare A and B</h2>
      <p className="muted">
        Only regions with the same label can be compared. A label marked once in each ad is paired
        automatically; otherwise choose the pairing below. Each heatmap is normalized within its own
        image, so cross-ad differences are exploratory signals, not measurements of real viewers.
      </p>

      {regionsA.length === 0 || regionsB.length === 0 ? (
        <p className="notice">Mark at least one region on each ad to compare them.</p>
      ) : (
        <>
          <h3>Pairings</h3>
          <ul className="pairings">
            {regionsA.map((ra) => {
              const pair = pairOf.get(ra.id);
              const pending = comparison.needsChoice.some((n) => n.a.id === ra.id);
              const options = regionsB.filter(
                (rb) => rb.label === ra.label && (!usedB.has(rb.id) || pair?.b.id === rb.id),
              );
              return (
                <li key={ra.id} className={pending ? "pairing pairing--pending" : "pairing"}>
                  <label>
                    <span>
                      A · {regionTitle(ra)} <span aria-hidden="true">→</span>
                      <span className="visually-hidden"> compared with</span>
                    </span>
                    <select
                      className="select"
                      value={pair?.b.id ?? ""}
                      disabled={options.length === 0}
                      onChange={(e) => props.onChoose(ra.id, e.target.value || null)}
                    >
                      <option value="">{options.length === 0 ? "No same-label region in B" : "Not compared"}</option>
                      {options.map((rb) => (
                        <option key={rb.id} value={rb.id}>
                          B · {regionTitle(rb)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {pair?.automatic && <span className="muted"> auto-paired (one of each)</span>}
                  {pending && <span className="pairing__hint"> choose which B region to compare</span>}
                </li>
              );
            })}
          </ul>

          {comparison.pairs.length > 0 && (
            <>
              <h3>Side by side</h3>
              {!ready ? (
                <p className="notice">Waiting for both analyses to finish…</p>
              ) : (
                <div className="table-wrap">
                  <table className="compare-table">
                    <caption className="visually-hidden">Paired region metrics for ads A and B</caption>
                    <thead>
                      <tr>
                        <th scope="col">Region</th>
                        <th scope="col">A area</th>
                        <th scope="col">A attention</th>
                        <th scope="col">A lift</th>
                        <th scope="col">B area</th>
                        <th scope="col">B attention</th>
                        <th scope="col">B lift</th>
                        <th scope="col">B − A attention</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.pairs.map((p) => {
                        const a = scoresA.get(p.a.id)!;
                        const b = scoresB.get(p.b.id)!;
                        const diff = (b.attentionMass - a.attentionMass) * 100;
                        return (
                          <tr key={`${p.a.id}-${p.b.id}`}>
                            <th scope="row">
                              {regionTitle(p.a)}
                              {regionTitle(p.a) !== regionTitle(p.b) && ` / ${regionTitle(p.b)}`}
                            </th>
                            <td>{pct(a.areaFraction)}</td>
                            <td>{pct(a.attentionMass)}</td>
                            <td>{times(a.lift)}</td>
                            <td>{pct(b.areaFraction)}</td>
                            <td>{pct(b.attentionMass)}</td>
                            <td>{times(b.lift)}</td>
                            <td>
                              {diff >= 0 ? "+" : "−"}
                              {Math.abs(diff).toFixed(1)} pp
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {ready && (
                <ul className="findings">
                  {comparison.pairs.map((p) => (
                    <li key={`${p.a.id}-${p.b.id}`}>
                      {explainPair(p, scoresA.get(p.a.id)!, scoresB.get(p.b.id)!)}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {(comparison.unmatchedA.length > 0 || comparison.unmatchedB.length > 0) && (
            <>
              <h3>Not compared</h3>
              <ul className="unmatched">
                {comparison.unmatchedA.map((r) => (
                  <li key={r.id}>A · {regionTitle(r)}</li>
                ))}
                {comparison.unmatchedB.map((r) => (
                  <li key={r.id}>B · {regionTitle(r)}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <button type="button" className="button" onClick={props.onExport} disabled={!scoresA && !scoresB}>
        Download results (JSON)
      </button>
    </section>
  );
}
