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
      <footer className="limits" aria-labelledby="limits-title">
        <h2 id="limits-title">What these numbers can and cannot tell you</h2>
        <ul>
          <li>
            Scores are predictions from DeepGaze IIE for a few seconds of free viewing. They are
            not validated against eye tracking on ads, and nobody has checked them against
            conversions.
          </li>
          <li>
            The model has a strong built-in preference for the image center. On a blank grey image
            it still puts 55% of the predicted attention in the central quarter. Regions near the
            edges start at a disadvantage whatever they contain.
          </li>
          <li>
            In our tests it gave little weight to small body text (a block of fine print scored
            0.26× lift) and to a drawn cartoon face (0.46×). Photographs of faces were not tested.
          </li>
          <li>
            Heatmap colors are scaled to each image&apos;s own peak. Compare the percentages, not
            the colors, across ads.
          </li>
          <li>
            The upstream model has no clear license. FocusFrame uses it for local, non-commercial
            evaluation only; see <code>docs/model-and-license.md</code>.
          </li>
        </ul>
      </footer>
    </main>
  );
}
