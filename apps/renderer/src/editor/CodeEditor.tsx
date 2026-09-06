import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { useEffect, useRef } from "react";

import { useEditor, type FileTab } from "@/stores/editor";
import { useHttp } from "@/stores/http";
import { useSession } from "@/stores/session";
import { useSettings } from "@/stores/settings";
import { useWorkspace } from "@/stores/workspace";
import { recallLastFile, rememberScroll } from "@/lib/lastFile";
import { extname, normalisePath } from "@/lib/utils";
import { colorSwatches } from "./features/colors";
import { emmet } from "./features/emmet";
import { diagnosticMarks } from "./features/diagnostics";
import { eslintSupport } from "./features/eslint";
import { inspections } from "./features/inspect/engine";
import { lspSupport } from "./features/lsp";
import { pathCompletion } from "./features/paths";
import { snippets } from "./features/snippets";
import { httpRunner } from "./features/httpRun";
import { tailwindCompletion } from "./features/tailwind";
import { breakpointSupport } from "./features/breakpoints";
import { gitGutter } from "./features/gitGutter";
import { ghostText } from "./features/ghostText";
import { navigationSupport } from "./features/navigation";
import { signatureHelp } from "./features/signatureHelp";
import { stickyScroll } from "./features/stickyScroll";
import { typescriptSupport } from "./features/typescript";
import { tagEditing } from "./features/tags";
import { languageFor } from "./languages";
import { codeHighlight, editorTheme } from "./theme";
import { useExtensions } from "@/stores/extensions";

const languageComp = new Compartment();
const tabSizeComp = new Compartment();
const wrapComp = new Compartment();

export function CodeEditor({ tab }: { tab: FileTab }) {
  const holder = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const pathRef = useRef(tab.path);

  const lastPushed = useRef<string | null>(null);
  const lastRecorded = useRef(0);

  const updateContent = useEditor((state) => state.updateContent);
  const setCursor = useEditor((state) => state.setCursor);
  const pendingReveal = useEditor((state) => state.pendingReveal);
  const pendingReplace = useEditor((state) => state.pendingReplace);
  const consumeReveal = useEditor((state) => state.consumeReveal);
  const consumeReplace = useEditor((state) => state.consumeReplace);
  const tabSize = useSettings((state) => state.tabSize);
  const useTabs = useSettings((state) => state.useTabs);
  const lineWrapping = useSettings((state) => state.lineWrapping);

  useEffect(() => {
    if (!holder.current) return;
    pathRef.current = tab.path;

    const state = EditorState.create({
      doc: tab.content,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        foldGutter(),
        stickyScroll(),
        history(),
        drawSelection(),
        dropCursor(),

        EditorState.allowMultipleSelections.of(true),
        rectangularSelection(),
        crosshairCursor(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        highlightSelectionMatches(),
        syntaxHighlighting(codeHighlight),
        editorTheme,

        colorSwatches(),
        emmet(extname(tab.path)),
        tagEditing(extname(tab.path)),
        pathCompletion(tab.path, useWorkspace.getState().root),
        snippets(extname(tab.path)),
        tailwindCompletion(extname(tab.path), useWorkspace.getState().root),
        diagnosticMarks(tab.path),
        typescriptSupport(extname(tab.path), tab.path, useWorkspace.getState().root),
        navigationSupport(extname(tab.path), tab.path, useWorkspace.getState().root),
        signatureHelp(extname(tab.path), tab.path, useWorkspace.getState().root),
        breakpointSupport(tab.path),
        gitGutter(tab.path, useWorkspace.getState().root),
        ghostText(tab.path),
        eslintSupport(extname(tab.path), tab.path, useWorkspace.getState().root),
        inspections(extname(tab.path), tab.path),
        lspSupport(tab.path, useWorkspace.getState().root),
        httpRunner(extname(tab.path), (request) => {

          useEditor.getState().openHttpResponse();
          void useHttp.getState().send(request);
        }),
        languageComp.of([]),
        tabSizeComp.of(indentUnit.of(useTabs ? "	" : " ".repeat(tabSize))),
        wrapComp.of(lineWrapping ? EditorView.lineWrapping : []),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const text = update.state.doc.toString();

            lastPushed.current = text;
            updateContent(pathRef.current, text);
          }
          if (update.selectionSet || update.docChanged) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            setCursor({ line: line.number, column: head - line.from + 1 });

            const now = Date.now();
            if (now - lastRecorded.current > 1000) {
              lastRecorded.current = now;
              useSession.getState().record({
                kind: "caret",
                path: pathRef.current,
                line: line.number,
              });
            }
          }
        }),
      ],
    });

    const instance = new EditorView({ state, parent: holder.current });
    view.current = instance;

    void languageFor(tab.path).then((language) => {
      if (language && view.current === instance) {
        instance.dispatch({ effects: languageComp.reconfigure(language) });
      }
    });

    const unsubscribe = useExtensions.subscribe((state, previous) => {
      if (state.installed === previous.installed) return;
      if (view.current !== instance) return;
      void languageFor(tab.path).then((language) => {
        if (view.current !== instance) return;
        instance.dispatch({ effects: languageComp.reconfigure(language ?? []) });
      });
    });

    return () => {
      unsubscribe();
      instance.destroy();
      view.current = null;
    };

  }, [tab.path]);

  useEffect(() => {
    view.current?.dispatch({
      effects: tabSizeComp.reconfigure(indentUnit.of(useTabs ? "	" : " ".repeat(tabSize))),
    });
  }, [tabSize, useTabs]);

  useEffect(() => {
    view.current?.dispatch({
      effects: wrapComp.reconfigure(lineWrapping ? EditorView.lineWrapping : []),
    });
  }, [lineWrapping]);

  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const scroller = instance.scrollDOM;

    const path = normalisePath(tab.path);

    const topPosition = (): number | null => {
      const box = scroller.getBoundingClientRect();
      return instance.posAtCoords({ x: box.left + 4, y: box.top + 4 });
    };

    let settled = false;
    let attempts = 0;
    let raf = 0;

    const restore = () => {
      const root = useWorkspace.getState().root;
      const place = root ? recallLastFile(root) : null;
      if (!place || normalisePath(place.path) !== path || place.topLine <= 1) {
        settled = true;
        return;
      }
      const total = instance.state.doc.lines;
      const target = instance.state.doc.line(Math.min(place.topLine, total));
      instance.dispatch({ effects: EditorView.scrollIntoView(target.from, { y: "start" }) });

      attempts += 1;
      const reached = topPosition();
      const good = reached !== null && instance.state.doc.lineAt(reached).number >= target.number - 2;
      if (good || attempts > 12) {
        settled = true;
        return;
      }
      raf = requestAnimationFrame(restore);
    };
    raf = requestAnimationFrame(restore);

    let timer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {

      if (!settled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const root = useWorkspace.getState().root;
        const at = topPosition();
        if (!root || at === null) return;
        rememberScroll(root, tab.path, instance.state.doc.lineAt(at).number);
      }, 400);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      scroller.removeEventListener("scroll", onScroll);
    };

  }, [tab.path]);

  useEffect(() => {
    if (!pendingReveal || pendingReveal.path !== tab.path) return;
    const instance = view.current;
    if (!instance) return;
    const docLength = instance.state.doc.length;

    let at: number;
    if (typeof pendingReveal.offset === "number") {
      at = Math.min(Math.max(0, pendingReveal.offset), docLength);
    } else {
      const lineCount = instance.state.doc.lines;
      const line = instance.state.doc.line(Math.min(Math.max(1, pendingReveal.line), lineCount));
      at = Math.min(line.from + Math.max(0, pendingReveal.column - 1), line.to);
    }
    instance.dispatch({
      selection: { anchor: at },
      effects: EditorView.scrollIntoView(at, { y: "center" }),
    });
    instance.focus();
    consumeReveal();
  }, [pendingReveal, tab.path, consumeReveal]);

  useEffect(() => {
    if (!pendingReplace || pendingReplace.path !== tab.path) return;
    const instance = view.current;
    if (!instance) return;
    instance.dispatch({
      changes: { from: 0, to: instance.state.doc.length, insert: pendingReplace.content },
    });
    consumeReplace();
  }, [pendingReplace, tab.path, consumeReplace]);

  useEffect(() => {
    const instance = view.current;
    if (!instance) return;

    if (tab.content === lastPushed.current) return;
    const current = instance.state.doc.toString();
    if (current === tab.content) return;
    lastPushed.current = tab.content;
    instance.dispatch({
      changes: { from: 0, to: current.length, insert: tab.content },
    });
  }, [tab.content]);

  if (tab.tooLarge) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-[12px] italic text-fg-dim">
          {tab.name} is too large to open ({Math.round(tab.size / 1024)} KB).
        </p>
      </div>
    );
  }

  return <div ref={holder} className="h-full" />;
}
