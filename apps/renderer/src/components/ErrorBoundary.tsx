import { Component, type ReactNode } from "react";

import { t } from "@/lib/i18n";

interface Props {
  children: ReactNode;
  label?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {

    console.error("[wide] a view crashed:", error);
  }

  reset = () => this.setState({ error: null });

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-canvas p-6 text-center">
        <p className="text-[13px] font-semibold text-fg-bright">{t("This view ran into a problem.")}</p>
        <p className="max-w-md break-words text-[11px] text-fg-faint">{String(error.message || error)}</p>
        <button
          type="button"
          onClick={this.reset}
          className="rounded-md border border-line px-3 py-1.5 text-[12px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
        >
          {t("Try again")}
        </button>
      </div>
    );
  }
}
