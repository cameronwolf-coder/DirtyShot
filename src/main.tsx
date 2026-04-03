import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { QuickOverlay } from "./components/overlay/QuickOverlay";
import { RecordingControls } from "./components/RecordingControls";
import { Toaster } from "sonner";
import { CheckCircle2 } from "lucide-react";

type RootKind = "main" | "quick-overlay" | "recording-controls";

function RootRouter() {
  const [kind] = useState<RootKind>(() => {
    const search = window.location.search;
    if (search.includes("overlay=1")) return "quick-overlay";
    if (search.includes("recording-controls=1")) return "recording-controls";
    return "main";
  });

  const content =
    kind === "recording-controls" ? (
      <RecordingControls />
    ) : kind === "quick-overlay" ? (
      <QuickOverlay />
    ) : (
      <>
        <App />
        <Toaster
          theme="dark"
          position="bottom-center"
          richColors={false}
          closeButton={false}
          icons={{
            success: (
              <div className="flex size-5 items-center justify-center rounded-full bg-green-500">
                <CheckCircle2 className="size-3 text-white" />
              </div>
            ),
          }}
          toastOptions={{
            className:
              "font-sans bg-card text-card-foreground shadow-lg rounded-full px-4 py-2 border border-border",
          }}
        />
      </>
    );

  return <React.StrictMode>{content}</React.StrictMode>;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <RootRouter />,
);
