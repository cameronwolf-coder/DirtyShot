import { useState, useEffect, useCallback } from "react";
import { Store } from "@tauri-apps/plugin-store";
import { ArrowLeft, Folder } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { BackgroundImageSelector } from "./BackgroundImageSelector";
import { KeyboardShortcutManager } from "./KeyboardShortcutManager";
import type { KeyboardShortcut } from "./KeyboardShortcutManager";

interface PreferencesPageProps {
  onBack: () => void;
  onSettingsChange?: () => void;
}

interface GeneralSettings {
  saveDir: string;
  copyToClipboard: boolean;
  copyOcrToClipboard: boolean;
  copyVideoToClipboard: boolean;
  showTrimmerAfterRecording: boolean;
}

export function PreferencesPage({ onBack, onSettingsChange }: PreferencesPageProps) {
  const [settings, setSettings] = useState<GeneralSettings>({
    saveDir: "",
    copyToClipboard: true,
    copyOcrToClipboard: true,
    copyVideoToClipboard: true,
    showTrimmerAfterRecording: true,
  });
  const [isLoading, setIsLoading] = useState(true);

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const store = await Store.load("settings.json");
        
        const copyToClip = await store.get<boolean>("copyToClipboard");
        const saveDir = await store.get<string>("saveDir");
        const copyOcrToClip = await store.get<boolean>("copyOcrToClipboard");
        const copyVideoToClip = await store.get<boolean>("copyVideoToClipboard");
        const showTrimmer = await store.get<boolean>("showTrimmerAfterRecording");

        setSettings({
          saveDir: saveDir || "",
          copyToClipboard: copyToClip ?? true,
          copyOcrToClipboard: copyOcrToClip ?? true,
          copyVideoToClipboard: copyVideoToClip ?? true,
          showTrimmerAfterRecording: showTrimmer ?? true,
        });
      } catch (err) {
        console.error("Failed to load settings:", err);
      } finally {
        setIsLoading(false);
      }
    };
    loadSettings();
  }, []);

  const updateSetting = useCallback(async <K extends keyof GeneralSettings>(
    key: K,
    value: GeneralSettings[K]
  ) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    
    try {
      const store = await Store.load("settings.json");
      await store.set(key, value);
      await store.save();
      onSettingsChange?.();
    } catch (err) {
      console.error(`Failed to save ${key}:`, err);
      toast.error(`Failed to save setting`);
    }
  }, [onSettingsChange]);

  const handleShortcutsChange = useCallback((_shortcuts: KeyboardShortcut[]) => {
    // Notify parent to re-register shortcuts
    onSettingsChange?.();
  }, [onSettingsChange]);

  const handleImageSelect = useCallback(async (_imageSrc: string) => {
    try {
      // The BackgroundImageSelector now handles converting to storable value
      // and saving to store, so we just need to notify of the change
      onSettingsChange?.();
    } catch (err) {
      console.error("Failed to save default background:", err);
      toast.error("Failed to save default background");
    }
  }, [onSettingsChange]);

  if (isLoading) {
    return (
      <main className="min-h-dvh flex items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading settings...</div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4 pb-2 border-b border-border">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground hover:bg-secondary"
            aria-label="Back to main"
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Preferences</h1>
            <p className="text-foreground0 text-sm">Configure your app settings</p>
          </div>
        </div>

        {/* General Settings */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold text-card-foreground">General</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Save Directory */}
            <div className="space-y-2">
              <label htmlFor="save-dir" className="text-sm font-medium text-foreground flex items-center gap-2">
                <Folder className="size-4" aria-hidden="true" />
                Save Directory
              </label>
              <input
                id="save-dir"
                type="text"
                value={settings.saveDir}
                onChange={(e) => updateSetting("saveDir", e.target.value)}
                placeholder="Enter save directory path (e.g., ~/Desktop)"
                className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-card-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all font-mono text-sm"
              />
              <p className="text-xs text-foreground0">Screenshots will be saved to this directory</p>
            </div>

            {/* Copy to Clipboard */}
            <div className="flex items-center justify-between py-2">
              <div>
                <label htmlFor="copy-clipboard" className="text-sm font-medium text-foreground cursor-pointer block">
                  Copy to clipboard
                </label>
                <p className="text-xs text-foreground0">Automatically copy screenshots to clipboard after saving</p>
              </div>
              <Switch
                id="copy-clipboard"
                checked={settings.copyToClipboard}
                onCheckedChange={(checked) => updateSetting("copyToClipboard", checked)}
              />
            </div>

            {/* Copy OCR to Clipboard */}
            <div className="flex items-center justify-between py-2">
              <div>
                <label htmlFor="copy-ocr-clipboard" className="text-sm font-medium text-foreground cursor-pointer block">
                  Auto-copy OCR text
                </label>
                <p className="text-xs text-foreground0">Automatically copy recognized text to clipboard after OCR</p>
              </div>
              <Switch
                id="copy-ocr-clipboard"
                checked={settings.copyOcrToClipboard}
                onCheckedChange={(checked) => updateSetting("copyOcrToClipboard", checked)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Recording Settings */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold text-card-foreground">Recording</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between py-2">
              <div>
                <label htmlFor="copy-video-clipboard" className="text-sm font-medium text-foreground cursor-pointer block">
                  Copy video to clipboard
                </label>
                <p className="text-xs text-foreground0">Automatically copy video file to clipboard after saving</p>
              </div>
              <Switch
                id="copy-video-clipboard"
                checked={settings.copyVideoToClipboard}
                onCheckedChange={(checked) => updateSetting("copyVideoToClipboard", checked)}
              />
            </div>
            <div className="flex items-center justify-between py-2">
              <div>
                <label htmlFor="show-trimmer" className="text-sm font-medium text-foreground cursor-pointer block">
                  Show trimmer after recording
                </label>
                <p className="text-xs text-foreground0">Open the video trimmer to edit before saving</p>
              </div>
              <Switch
                id="show-trimmer"
                checked={settings.showTrimmerAfterRecording}
                onCheckedChange={(checked) => updateSetting("showTrimmerAfterRecording", checked)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Default Background */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold text-card-foreground">Default Background</CardTitle>
          </CardHeader>
          <CardContent>
            <BackgroundImageSelector onImageSelect={handleImageSelect} />
          </CardContent>
        </Card>

        {/* Keyboard Shortcuts */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold text-card-foreground">Keyboard Shortcuts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <KeyboardShortcutManager onShortcutsChange={handleShortcutsChange} />
            
            {/* Editor Shortcuts Reference */}
            <div className="space-y-3 pt-4 border-t border-border">
              <div>
                <p className="text-xs text-foreground0 uppercase tracking-wide mb-3">Editor</p>
                <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Save</span>
                    <kbd className="px-2 py-1 bg-secondary border border-border rounded text-foreground font-mono text-xs tabular-nums">⌘S</kbd>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Copy</span>
                    <kbd className="px-2 py-1 bg-secondary border border-border rounded text-foreground font-mono text-xs tabular-nums">⇧⌘C</kbd>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Undo</span>
                    <kbd className="px-2 py-1 bg-secondary border border-border rounded text-foreground font-mono text-xs tabular-nums">⌘Z</kbd>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Redo</span>
                    <kbd className="px-2 py-1 bg-secondary border border-border rounded text-foreground font-mono text-xs tabular-nums">⇧⌘Z</kbd>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Delete annotation</span>
                    <kbd className="px-2 py-1 bg-secondary border border-border rounded text-foreground font-mono text-xs tabular-nums">⌫</kbd>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Close editor</span>
                    <kbd className="px-2 py-1 bg-secondary border border-border rounded text-foreground font-mono text-xs tabular-nums">Esc</kbd>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* About */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold text-card-foreground">About</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium text-foreground">Better Shot</p>
              <p className="text-xs text-foreground0">Version {__APP_VERSION__}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
