import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FocusFrame: predicted visual attention for static ads",
  description:
    "Compare where a pretrained saliency model predicts visual attention on two static ad layouts.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
