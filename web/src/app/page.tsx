import { Workspace } from "@/components/Workspace";

export default function Home() {
  return (
    <main className="page">
      <header className="masthead">
        <h1 className="masthead__title">FocusFrame</h1>
        <p className="masthead__lede">
          Upload one or two static ads, mark the regions that matter, and see how much of a
          pretrained model&apos;s <em>predicted</em> visual attention falls inside each one.
        </p>
        <p className="disclaimer" role="note">
          <strong>Attention is not conversion.</strong> The heatmap is a free-viewing fixation
          prediction from a model trained on natural photographs, not eye tracking of your audience,
          and it does not predict clicks, conversions, or sales.
        </p>
      </header>
      <Workspace />
    </main>
  );
}
