"use client";

import { useRef, useState, useEffect } from "react";
import { useCreatorStore } from "@/lib/creator/state/store";
import { LottieParser } from "@/lib/creator/lottie/LottieParser";
import CanvasView from "./components/Canvas/CanvasView";
import Navbar from "./components/Toolbar/Navbar";
import LayersPanel from "./components/Layers/LayersPanel";
import InspectorPanel from "./components/Inspector/InspectorPanel";
import TimelinePanel from "./components/Timeline/TimelinePanel";
import StatusBar from "./components/StatusBar";
import ResizablePanel from "./components/Layout/ResizablePanel";
import { AlertTriangle, FileJson, Zap } from "lucide-react";
import { extractGlyphsForScene } from "@/lib/creator/text/GlyphExtractor";
import { getFontFileUrl } from "@/lib/creator/fonts/GoogleFontsService";
import { LottieExporter } from "@/lib/creator/lottie/LottieExporter";
import SegmentsPanel from "./components/Toolbar/SegmentsPanel";
import DiscoverLogosModal from "./components/Toolbar/DiscoverLogosModal";
import StateMachinePanel from "./components/StateMachine/StateMachinePanel";
import InputsPanel from "./components/StateMachine/InputsPanel";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import {
  StateMachineData,
  StateMachineInput,
  StateMachineNode,
  StateMachineEdge,
  StateMachineInteraction,
  StateMachineAction,
  InputType,
  InteractionEvent,
  ActionType,
  GuardOperator,
  GuardCondition,
} from "@/lib/creator/state/stateMachineSlice";
import { SceneNode } from "@/lib/creator/state/sceneSlice";
import { FlowBlock } from "@/lib/creator/state/animationSlice";

const generateId = () => Math.random().toString(36).substr(2, 9);

/**
 * Maps dotLottie v2 State Machine JSON to internal StateMachineData format.
 */
function mapDotLottieStateMachine(
  smJson: {
    id?: string;
    name?: string;
    initial?: string;
    inputs?: Array<{
      name: string;
      type: string;
      value?: boolean | number | string | null;
    }>;
    states?: Array<{
      name: string;
      type: string;
      segment?: string;
      autoplay?: boolean;
      loop?: boolean;
      speed?: number;
      mode?: string;
      transitions?: Array<{
        toState: string;
        guards?: Array<{
          inputName: string;
          conditionType?: string;
          compareTo?: boolean | number | string;
        }>;
      }>;
    }>;
    interactions?: Array<{
      type: string;
      layerName?: string;
      stateName?: string;
      actions?: Array<{
        type: string;
        inputName: string;
        value?: boolean | number | string;
      }>;
    }>;
  },
  importedNodes: SceneNode[],
  flowBlocks: FlowBlock[],
): StateMachineData {
  const smId = smJson.id || `sm_${generateId()}`;
  const smName = smJson.name || "Imported State Machine";

  // 1. Map Inputs
  const inputMap = new Map<string, string>(); // name -> internalId
  const inputs: StateMachineInput[] = (smJson.inputs || []).map((inp) => {
    const id = `input_${generateId()}`;
    inputMap.set(inp.name, id);

    let type: InputType = "Boolean";
    if (inp.type === "Number") type = "Number";
    if (inp.type === "String") type = "String";
    if (inp.type === "Event") type = "Trigger";

    return {
      id,
      name: inp.name,
      type,
      initialValue:
        inp.value !== undefined
          ? inp.value
          : type === "Boolean"
            ? false
            : type === "Number"
              ? 0
              : null,
    };
  });

  // 2. Map Nodes (States)
  const nodeMap = new Map<string, string>(); // dotLottieName -> internalId

  // Rank-based layout heuristic
  const ranks: Map<string, number> = new Map();
  const queue: Array<{ name: string; rank: number }> = [];

  if (smJson.initial) queue.push({ name: smJson.initial, rank: 0 });
  (smJson.states || [])
    .filter((s) => s.type === "GlobalState")
    .forEach((s) => {
      if (!queue.find((q) => q.name === s.name)) {
        queue.push({ name: s.name, rank: 0 });
      }
    });

  const processed = new Set<string>();
  while (queue.length > 0) {
    const { name, rank } = queue.shift()!;
    if (processed.has(name)) continue;
    processed.add(name);

    // Only set rank if not already set (keep shortest path from start)
    if (!ranks.has(name)) ranks.set(name, rank);

    const stateDesc = smJson.states?.find((s) => s.name === name);
    (stateDesc?.transitions || []).forEach((t) => {
      if (!processed.has(t.toState)) {
        queue.push({ name: t.toState, rank: rank + 1 });
      }
    });
  }

  const nodesPerRank: Record<number, number> = {};

  const nodes: StateMachineNode[] = (smJson.states || []).map((st) => {
    const id = `node_${generateId()}`;
    nodeMap.set(st.name, id);

    const rank = ranks.has(st.name) ? ranks.get(st.name)! : 0;
    const indexInRank = nodesPerRank[rank] || 0;
    nodesPerRank[rank] = indexInRank + 1;

    // Layout: horizontally by rank, vertically by index in rank
    const x = 100 + rank * 280;
    const y = 80 + indexInRank * 160;

    const node: StateMachineNode = {
      id,
      name: st.name,
      type: st.type === "GlobalState" ? "global" : "playback",
      position: { x, y },
      isInitial: st.name === smJson.initial,
      // dotLottie v2: autoplay/loop default to false if not specified
      loop: st.loop === true,
      autoplay: st.autoplay === true,
      speed: st.speed || 1,
      mode:
        st.mode === "Reverse"
          ? "Reverse"
          : st.mode === "PingPong"
            ? "PingPong"
            : "Forward",
    };

    // Link to FlowBlock segment
    if (st.segment) {
      const block = flowBlocks.find((b) => b.name === st.segment);
      if (block) node.segmentId = block.id;
    }

    return node;
  });

  // 3. Map Transitions (Edges)
  const edges: StateMachineEdge[] = [];
  (smJson.states || []).forEach((st) => {
    const sourceId = nodeMap.get(st.name);
    if (!sourceId || !st.transitions) return;

    st.transitions.forEach((trans) => {
      const targetId = nodeMap.get(trans.toState);
      if (!targetId) return;

      const guards: GuardCondition[] = (trans.guards || []).map((g) => {
        const inputId = inputMap.get(g.inputName);

        let operator: GuardOperator = "==";
        if (g.conditionType === "NotEqual") operator = "!=";
        if (g.conditionType === "Greater") operator = ">";
        if (g.conditionType === "Less") operator = "<";
        if (g.conditionType === "GreaterEqual") operator = ">=";
        if (g.conditionType === "LessEqual") operator = "<=";

        return {
          id: `guard_${generateId()}`,
          inputId: inputId || "",
          operator,
          value: g.compareTo !== undefined ? g.compareTo : true,
        };
      });

      edges.push({
        id: `edge_${generateId()}`,
        sourceId,
        targetId,
        guards,
      });
    });
  });

  // 4. Map Interactions (Layer interactions + State-based events)
  const smInteractions: StateMachineInteraction[] = [];

  (smJson.interactions || []).forEach((inter) => {
    const t = inter.type.toLowerCase();
    if (
      t === "oncomplete" ||
      t === "complete" ||
      t === "onloopcomplete" ||
      t === "loopcomplete"
    ) {
      // These are matched to node actions, not layer interactions
      const targetNode = nodes.find((n) => n.name === inter.stateName);
      if (!targetNode) return;

      const actions: StateMachineAction[] = (inter.actions || []).map((act) => {
        const inputId = inputMap.get(act.inputName);
        return {
          id: `act_${generateId()}`,
          type:
            act.type === "Fire" || act.type === "fire"
              ? "FireEvent"
              : "SetInput",
          inputId,
          value: act.value ?? undefined,
        };
      });

      if (t === "oncomplete" || t === "complete") {
        targetNode.onCompleteActions = [
          ...(targetNode.onCompleteActions || []),
          ...actions,
        ];
      } else {
        targetNode.onLoopCompleteActions = [
          ...(targetNode.onLoopCompleteActions || []),
          ...actions,
        ];
      }
      return;
    }

    // Layer-based interactions
    if (!inter.layerName) return;
    const targetNode = importedNodes.find((n) => n.name === inter.layerName);

    // Map event type
    let event: InteractionEvent = "Click";
    if (t === "pointerenter" || t === "mouseenter") event = "PointerEnter";
    else if (t === "pointerexit" || t === "mouseleave") event = "PointerExit";
    else if (t === "pointerdown" || t === "mousedown") event = "PointerDown";
    else if (t === "pointerup" || t === "mouseup") event = "PointerUp";
    else if (t === "pointermove" || t === "mousemove") event = "PointerMove";
    else if (t === "click") event = "Click";

    const actions: StateMachineAction[] = (inter.actions || []).map(
      (act: any) => {
        const inputId = inputMap.get(act.inputName);
        let type: ActionType = "SetInput";
        if (act.type === "Fire" || act.type === "fire") type = "FireEvent";

        return {
          id: `act_${generateId()}`,
          type,
          inputId,
          value: act.value ?? undefined,
        };
      },
    );

    smInteractions.push({
      id: `inter_${generateId()}`,
      event,
      layerId: targetNode?.id || "",
      actions,
    });
  });

  return {
    id: smId,
    name: smName,
    inputs,
    nodes,
    edges,
    interactions: smInteractions.filter((i) => i.layerId), // only keep interactions linked to real layers
  };
}

export default function CreatorPage() {
  const activePanel = useCreatorStore((state) => state.activePanel);
  const setActivePanel = useCreatorStore((state) => state.setActivePanel);
  const addNodesBatch = useCreatorStore((state) => state.addNodesBatch);
  const nodes = useCreatorStore((state) => state.nodes);
  const fps = useCreatorStore((state) => state.fps);
  const duration = useCreatorStore((state) => state.duration);
  const creatorMode = useCreatorStore((state) => state.creatorMode);
  const isTimelineCollapsed = useCreatorStore(
    (state) => state.isTimelineCollapsed,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [exportSettings, setExportSettings] = useState({
    filename: "animation",
    fps: 0, // 0 means use project default
    loop: true,
    format: "lottie" as "json" | "lottie",
    embedGlyphs: false,
  });

  const exportLottie = async (format?: "json" | "lottie") => {
    const finalFormat = format || exportSettings.format;
    const finalFps = exportSettings.fps || fps;
    const artboard = Array.from(nodes.values()).find(
      (n) => n.type === "artboard",
    );
    const finalFilename =
      exportSettings.filename !== "animation"
        ? exportSettings.filename
        : artboard?.name || "animation";

    try {
      const flowBlocks = useCreatorStore.getState().flowBlocks;
      const stateMachine = useCreatorStore.getState().stateMachine;
      const lottieJson = LottieExporter.export(
        nodes,
        finalFps,
        duration,
        flowBlocks,
      );

      if (exportSettings.embedGlyphs) {
        const glyphs = await extractGlyphsForScene(nodes, (family, weight) =>
          getFontFileUrl(family, weight),
        );
        if (glyphs.length > 0) lottieJson.chars = glyphs;
      }

      if (finalFormat === "json") {
        const blob = new Blob([JSON.stringify(lottieJson)], {
          type: "application/json",
        });
        saveAs(blob, `${finalFilename}.json`);
      } else {
        const zip = new JSZip();

        // --- dotLottie v2 format ---
        const animationId = artboard?.name || "animation";
        zip.file(`a/${animationId}.json`, JSON.stringify(lottieJson));

        // Build manifest
        const manifest: Record<string, any> = {
          version: "2",
          generator: "LottiePro Creator",
          animations: [{ id: animationId }],
        };

        // Export State Machine if it has content
        if (
          stateMachine &&
          (stateMachine.inputs.length > 0 || stateMachine.nodes.length > 0)
        ) {
          const smId = stateMachine.name || "StateMachine1";

          // --- Build lookup maps ---
          // nodeId → node name
          const nodeNameMap = new Map<string, string>();
          stateMachine.nodes.forEach((n) => nodeNameMap.set(n.id, n.name));

          // inputId → input object
          const inputById = new Map<string, (typeof stateMachine.inputs)[0]>();
          stateMachine.inputs.forEach((inp) => inputById.set(inp.id, inp));

          // segmentId → segment name
          const segmentNameMap = new Map<string, string>();
          flowBlocks.forEach((b) => segmentNameMap.set(b.id, b.name));

          // layerId → layer name (from scene nodes)
          const layerNameById = new Map<string, string>();
          nodes.forEach((node, id) => layerNameById.set(id, node.name));

          // --- Find initial state name ---
          const initialNode = stateMachine.nodes.find(
            (n) => n.isInitial || n.type === "initial",
          );
          const initialStateName = initialNode ? initialNode.name : "";

          // --- Map guard operator to conditionType ---
          const operatorToCondition: Record<string, string> = {
            "==": "Equal",
            "!=": "NotEqual",
            ">": "Greater",
            "<": "Less",
            ">=": "GreaterEqual",
            "<=": "LessEqual",
          };

          // --- Map action type to v2 format ---
          const mapActionTypeForExport = (
            actionType: string,
            inputId?: string,
          ): string => {
            if (actionType === "FireEvent") return "Fire";
            if (actionType === "SetInput") {
              const input = inputId ? inputById.get(inputId) : undefined;
              if (input?.type === "Boolean") return "SetBoolean";
              if (input?.type === "Number") return "SetNumber";
              if (input?.type === "String") return "SetString";
              return "SetBoolean"; // Default fallback
            }
            if (actionType === "Toggle") return "Toggle";
            if (actionType === "Increment") return "Increment";
            if (actionType === "Decrement") return "Decrement";
            if (actionType === "Reset") return "Reset";
            if (actionType === "OpenURL") return "OpenURL";
            return actionType;
          };

          // --- Build v2 states array ---
          const exportStates: Array<Record<string, any>> = [];

          stateMachine.nodes.forEach((smNode) => {
            const state: Record<string, any> = {
              name: smNode.name,
              type: smNode.type === "global" ? "GlobalState" : "PlaybackState",
              animation: "", // Single animation, empty string per LottieFiles convention
            };

            if (smNode.type !== "global") {
              // Add playback configuration
              if (smNode.segmentId) {
                state.segment =
                  segmentNameMap.get(smNode.segmentId) || smNode.segmentId;
              }
              if (smNode.autoplay === true) state.autoplay = true;
              if (smNode.loop === true) state.loop = true;
              if (smNode.speed !== undefined && smNode.speed !== 1)
                state.speed = smNode.speed;
              if (smNode.mode && smNode.mode !== "Forward")
                state.mode = smNode.mode;
            }

            // --- Embed transitions (edges from this node) ---
            const nodeEdges = stateMachine.edges.filter(
              (e) => e.sourceId === smNode.id,
            );
            state.transitions = nodeEdges.map((edge) => {
              const targetName =
                nodeNameMap.get(edge.targetId) || edge.targetId;
              const guards = edge.guards
                .map((g) => {
                  const input = inputById.get(g.inputId);
                  if (!input) return null;

                  const guard: Record<string, any> = {
                    type: input.type === "Trigger" ? "Event" : input.type,
                    inputName: input.name,
                  };

                  // For non-trigger types, add conditionType and compareTo
                  if (input.type !== "Trigger") {
                    guard.conditionType =
                      operatorToCondition[g.operator] || "Equal";
                    guard.compareTo = g.value;
                  }

                  return guard;
                })
                .filter(Boolean);

              return {
                type: "Transition",
                toState: targetName,
                guards,
              };
            });

            exportStates.push(state);
          });

          // --- Build v2 inputs array ---
          const exportInputs = stateMachine.inputs.map((inp) => {
            const entry: Record<string, any> = {
              type: inp.type === "Trigger" ? "Event" : inp.type,
              name: inp.name,
            };
            // Only include value for non-Event types
            if (
              inp.type !== "Trigger" &&
              inp.initialValue !== undefined &&
              inp.initialValue !== null
            ) {
              entry.value = inp.initialValue;
            }
            return entry;
          });

          // --- Build v2 interactions array ---
          const exportInteractions: Array<Record<string, any>> = [];

          // Layer-based interactions
          (stateMachine.interactions || []).forEach((int) => {
            const layerName = layerNameById.get(int.layerId) || int.layerId;
            const actions = int.actions.map((act) => {
              const entry: Record<string, any> = {
                type: mapActionTypeForExport(act.type, act.inputId),
              };
              const input = act.inputId
                ? inputById.get(act.inputId)
                : undefined;
              if (input) entry.inputName = input.name;
              if (act.value !== undefined) entry.value = act.value;
              if (act.url) entry.url = act.url;
              return entry;
            });

            exportInteractions.push({
              type: int.event, // 'Click', 'PointerEnter', etc.
              layerName,
              actions,
            });
          });

          // OnComplete / OnLoopComplete actions → separate interactions
          stateMachine.nodes.forEach((smNode) => {
            if (
              smNode.onCompleteActions &&
              smNode.onCompleteActions.length > 0
            ) {
              const actions = smNode.onCompleteActions.map((act) => {
                const entry: Record<string, any> = {
                  type: mapActionTypeForExport(act.type, act.inputId),
                };
                const input = act.inputId
                  ? inputById.get(act.inputId)
                  : undefined;
                if (input) entry.inputName = input.name;
                if (act.value !== undefined) entry.value = act.value;
                return entry;
              });
              exportInteractions.push({
                type: "OnComplete",
                stateName: smNode.name,
                actions,
              });
            }

            if (
              smNode.onLoopCompleteActions &&
              smNode.onLoopCompleteActions.length > 0
            ) {
              const actions = smNode.onLoopCompleteActions.map((act) => {
                const entry: Record<string, any> = {
                  type: mapActionTypeForExport(act.type, act.inputId),
                };
                const input = act.inputId
                  ? inputById.get(act.inputId)
                  : undefined;
                if (input) entry.inputName = input.name;
                if (act.value !== undefined) entry.value = act.value;
                return entry;
              });
              exportInteractions.push({
                type: "OnLoopComplete",
                stateName: smNode.name,
                actions,
              });
            }
          });

          // --- Assemble v2 State Machine JSON ---
          const smJson: Record<string, any> = {
            initial: initialStateName,
            states: exportStates,
            inputs: exportInputs,
            interactions: exportInteractions,
          };

          zip.file(`s/${smId}.json`, JSON.stringify(smJson));
          manifest.stateMachines = [{ id: smId, name: smId }];
        }

        zip.file("manifest.json", JSON.stringify(manifest));
        const content = await zip.generateAsync({
          type: "blob",
          compression: "DEFLATE",
          compressionOptions: { level: 9 },
        });
        saveAs(content, `${finalFilename}.lottie`);
      }
      console.log(`✅ Successfully exported as ${finalFormat}`);
      setShowSettingsModal(false);
    } catch (err) {
      console.error("Export failed:", err);
    }
  };

  const handleFileImport = async (file: File) => {
    if (!file.name.endsWith(".json") && !file.name.endsWith(".lottie")) {
      alert("Please select a Lottie JSON or .lottie file");
      return;
    }

    try {
      let jsonObj: Record<string, unknown> | null = null;

      if (file.name.endsWith(".lottie")) {
        // --- Parse .lottie ZIP structure ---
        const zip = await JSZip.loadAsync(file);

        // 1. Read manifest to find the animation
        const manifestStr = await zip.file("manifest.json")?.async("string");
        if (!manifestStr)
          throw new Error("Invalid .lottie file: missing manifest.json");

        const manifest: {
          animations: Array<{ id: string }>;
          stateMachines?: Array<{ id: string; name: string }>;
        } = JSON.parse(manifestStr);

        if (!manifest.animations || manifest.animations.length === 0) {
          throw new Error("No animations found in .lottie manifest");
        }

        // We'll load the first animation for now
        const animMeta = manifest.animations[0];
        const animPath = `animations/${animMeta.id}.json`;
        const animPathFallback = `a/${animMeta.id}.json`; // v2 fallback

        let animJsonStr = await zip.file(animPath)?.async("string");
        if (!animJsonStr)
          animJsonStr = await zip.file(animPathFallback)?.async("string");
        if (!animJsonStr)
          throw new Error(
            `Animation file not found in archive for ID: ${animMeta.id}`,
          );

        jsonObj = JSON.parse(animJsonStr);

        // 1.5 Extract State Machine if present (v2)
        if (manifest.stateMachines && manifest.stateMachines.length > 0) {
          const smMeta = manifest.stateMachines[0];
          const smPath = `states/${smMeta.id}.json`;
          const smPathFallback = `s/${smMeta.id}.json`;

          let smJsonStr = await zip.file(smPath)?.async("string");
          if (!smJsonStr)
            smJsonStr = await zip.file(smPathFallback)?.async("string");

          if (smJsonStr) {
            try {
              const smJson = JSON.parse(smJsonStr) as Parameters<
                typeof mapDotLottieStateMachine
              >[0];
              // We'll wrap the actual mapping in the handleFileImport's end cycle
              // after we have the nodes and flowBlocks.
              if (jsonObj) jsonObj._smJson = smJson;
            } catch (e) {
              console.warn("Failed to parse state machine JSON", e);
            }
          }
        }

        // 2. Pre-process embedded images
        // The LottieParser expects either a URL or a base64 string directly in `p`.
        // If the Lottie JSON references external files (u + p), we need to extract
        // them from the zip and convert to Base64 data URIs.
        if (jsonObj && jsonObj.assets && Array.isArray(jsonObj.assets)) {
          for (const asset of jsonObj.assets) {
            if (
              asset &&
              typeof asset === "object" &&
              asset.w &&
              asset.h &&
              asset.p
            ) {
              // It's likely an image. Check if it's external (not already base64)
              if (typeof asset.p === "string" && !asset.p.startsWith("data:")) {
                // Find image in zip (either images/filename or i/filename)
                let imgPath = asset.u
                  ? `${asset.u}${asset.p}`
                  : `images/${asset.p}`;
                if (imgPath.startsWith("/")) imgPath = imgPath.slice(1);

                let imgFile = zip.file(imgPath);
                // Also try common dotLottie paths if exact path fails
                if (!imgFile) imgFile = zip.file(`images/${asset.p}`);
                if (!imgFile) imgFile = zip.file(`i/${asset.p}`);

                if (imgFile) {
                  // Get raw bytes and convert to base64 data URI
                  const ext = asset.p.split(".").pop()?.toLowerCase() || "png";
                  const mime =
                    ext === "svg"
                      ? "image/svg+xml"
                      : ext === "jpeg" || ext === "jpg"
                        ? "image/jpeg"
                        : "image/png";
                  const base64 = await imgFile.async("base64");

                  // Inject base64 directly into the JSON asset
                  asset.p = `data:${mime};base64,${base64}`;
                  asset.u = ""; // clear path prefix since it's now inline
                  asset.e = 1; // set encoded flag to 1 (standard Lottie flag for inline base64)
                }
              }
            }
          }
        }
      } else {
        // --- Standard .json parsing ---
        const text = await file.text();
        jsonObj = JSON.parse(text);
      }

      if (!jsonObj) throw new Error("Failed to parse animation data");

      // --- Pass to existing pipeline ---
      const {
        nodes: importedNodes,
        fps: importedFps,
        duration: importedDuration,
        flowBlocks,
        importWarnings,
      } = LottieParser.parse(jsonObj);

      const rootArtboard = importedNodes.find((n) => n.type === "artboard");
      if (!rootArtboard) throw new Error("No root artboard found in Lottie");

      // Strip internal metadata before storing (avoid circular refs, keep JSON clean)
      const { _smJson: _stripped, ...cleanSource } = jsonObj;

      useCreatorStore.setState({
        nodes: new Map(),
        selectedIds: [],
        currentTime: 0,
        activeArtboardId: rootArtboard.id,
        flowBlocks: flowBlocks || [],
        rawAnimationSource: cleanSource,
      });

      useCreatorStore.getState().setFps(importedFps);
      useCreatorStore.getState().setDuration(importedDuration);

      addNodesBatch(importedNodes);

      // Build the surgical Lottie cache now that both rawAnimationSource and nodes are in the store.
      // This cache is incrementally patched on every edit, replacing full LottieExporter.export() calls.
      useCreatorStore.getState().buildLottieCache();

      // --- State Machine Integration ---
      if (jsonObj._smJson) {
        try {
          const mappedSM = mapDotLottieStateMachine(
            jsonObj._smJson,
            importedNodes,
            flowBlocks,
          );
          useCreatorStore.setState({ stateMachine: mappedSM });
          console.log(
            `🎮 Successfully imported State Machine: ${mappedSM.name}`,
          );
        } catch (smErr) {
          console.error("Failed to map State Machine:", smErr);
        }
      }

      console.log(
        `✅ Successfully imported project "${rootArtboard.name}" with ${importedNodes.length} nodes`,
      );

      // Phase 3: surface import warnings (passthrough shapes, expressions, etc.)
      if (importWarnings.length > 0) {
        const layerCount = importWarnings.length;
        const exampleWarnings = importWarnings
          .slice(0, 3)
          .map((w) => `• ${w.layerName}: ${w.warnings[0]}`)
          .join("\n");
        const more =
          layerCount > 3 ? `\n…and ${layerCount - 3} more layer(s)` : "";
        console.warn(
          `[Import] ${layerCount} layer(s) have limited editability:\n${exampleWarnings}${more}`,
        );
        // Non-blocking — the animation will play and transform edits still work
      }
    } catch (err) {
      console.error("Failed to parse file:", err);
      alert(
        `Failed to import file: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }
  };

  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      const state = useCreatorStore.getState();
      console.log(`[KEY] "${e.key}" | Panel: ${state.activePanel}`);
    };
    window.addEventListener("keydown", handleGlobalKey, true);
    return () => window.removeEventListener("keydown", handleGlobalKey, true);
  }, []);

  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden text-primary"
      style={{ background: "var(--bg-app)" }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer.files?.[0])
          handleFileImport(e.dataTransfer.files[0]);
      }}
    >
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept=".json,.lottie"
        onChange={(e) => {
          if (e.target.files?.[0]) {
            handleFileImport(e.target.files[0]);
            e.target.value = "";
          }
        }}
      />

      {/* ── Navbar ──────────────────────────────────────────── */}
      <Navbar
        onImportLottie={() => fileInputRef.current?.click()}
        onExport={(format) => {
          setExportSettings((prev) => ({ ...prev, format }));
          setShowSettingsModal(true);
        }}
      />

      {/* ── Main Workspace ───────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Content column */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Canvas + side panels row */}
          <div className="flex-1 flex overflow-hidden">
            {/* Layers panel — animate mode only */}
            {creatorMode === "animate" && (
              <ResizablePanel
                direction="horizontal"
                initialSize={260}
                minSize={180}
                maxSize={400}
                side="right"
                className="border-r border-white/[0.06] h-full"
                style={{ background: "var(--bg-panel)" } as React.CSSProperties}
              >
                <div
                  tabIndex={0}
                  onMouseDownCapture={(e) => {
                    setActivePanel("layers");
                    (e.currentTarget as HTMLElement).focus();
                  }}
                  onFocusCapture={() => setActivePanel("layers")}
                  className="h-full outline-none"
                >
                  <LayersPanel />
                </div>
              </ResizablePanel>
            )}

            {/* Canvas */}
            <div
              tabIndex={0}
              className="flex-1 relative overflow-hidden outline-none"
              style={{ background: "var(--bg-canvas)" }}
              onMouseDownCapture={(e) => {
                setActivePanel("canvas");
                (e.currentTarget as HTMLElement).focus();
              }}
              onFocusCapture={() => setActivePanel("canvas")}
            >
              <CanvasView />
            </div>

            {/* Inspector / Inputs panel */}
            <ResizablePanel
              direction="horizontal"
              initialSize={310}
              minSize={240}
              maxSize={500}
              side="left"
              className="border-l border-white/[0.06] h-full"
              style={{ background: "var(--bg-panel)" } as React.CSSProperties}
            >
              <div
                tabIndex={0}
                onMouseDownCapture={(e) => {
                  setActivePanel("inspector");
                  (e.currentTarget as HTMLElement).focus();
                }}
                onFocusCapture={() => setActivePanel("inspector")}
                className="h-full outline-none"
              >
                {creatorMode === "animate" ? (
                  <InspectorPanel />
                ) : (
                  <InputsPanel />
                )}
              </div>
            </ResizablePanel>
          </div>

          {/* Timeline / State Machine */}
          <ResizablePanel
            direction="vertical"
            initialSize={creatorMode === "animate" ? 240 : 350}
            minSize={140}
            maxSize={800}
            side="top"
            collapsed={creatorMode === "animate" ? isTimelineCollapsed : false}
            className="border-t border-white/[0.06] z-20"
            style={{ background: "var(--bg-panel)" } as React.CSSProperties}
          >
            <div
              tabIndex={0}
              onMouseDownCapture={(e) => {
                setActivePanel("timeline");
                (e.currentTarget as HTMLElement).focus();
              }}
              onFocusCapture={() => setActivePanel("timeline")}
              className="h-full outline-none"
            >
              {creatorMode === "animate" ? (
                <TimelinePanel />
              ) : (
                <StateMachinePanel />
              )}
            </div>
          </ResizablePanel>
        </div>
      </div>

      <StatusBar />
      <SegmentsPanel />
      <DiscoverLogosModal />

      {/* ── Export Settings Modal ────────────────────────────── */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4">
          <div
            className="w-full max-w-sm rounded-xl overflow-hidden"
            style={{
              background: "var(--bg-panel)",
              border: "1px solid rgba(255,255,255,0.10)",
              boxShadow: "var(--shadow-modal)",
            }}
          >
            {/* Modal header */}
            <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-md bg-accent/15 flex items-center justify-center text-accent">
                  {exportSettings.format === "lottie" ? (
                    <Zap size={15} />
                  ) : (
                    <FileJson size={15} />
                  )}
                </div>
                <h3 className="text-sm font-semibold text-primary">
                  Export{" "}
                  {exportSettings.format === "lottie" ? "dotLottie" : "JSON"}
                </h3>
              </div>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:text-primary hover:bg-hover transition-colors text-base leading-none"
              >
                ×
              </button>
            </div>

            {/* Modal body */}
            <div className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium text-muted uppercase tracking-widest">
                  Filename
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={exportSettings.filename}
                    onChange={(e) =>
                      setExportSettings((prev) => ({
                        ...prev,
                        filename: e.target.value,
                      }))
                    }
                    className="w-full rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted border border-white/10 focus:border-accent/60 focus:outline-none transition-colors pr-16"
                    style={{ background: "var(--bg-surface)" }}
                    placeholder="animation"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-muted">
                    .{exportSettings.format}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-medium text-muted uppercase tracking-widest">
                    Frame Rate
                  </label>
                  <input
                    type="number"
                    value={exportSettings.fps || fps}
                    onChange={(e) =>
                      setExportSettings((prev) => ({
                        ...prev,
                        fps: parseInt(e.target.value),
                      }))
                    }
                    className="w-full rounded-md px-3 py-2 text-sm text-primary border border-white/10 focus:border-accent/60 focus:outline-none transition-colors"
                    style={{ background: "var(--bg-surface)" }}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-medium text-muted uppercase tracking-widest">
                    Loop
                  </label>
                  <button
                    onClick={() =>
                      setExportSettings((prev) => ({
                        ...prev,
                        loop: !prev.loop,
                      }))
                    }
                    className={`w-full flex items-center justify-between rounded-md px-3 py-2 text-sm border transition-all ${
                      exportSettings.loop
                        ? "text-accent border-accent/30"
                        : "text-muted border-white/10 hover:border-white/20"
                    }`}
                    style={{ background: "var(--bg-surface)" }}
                  >
                    <span>{exportSettings.loop ? "On" : "Off"}</span>
                    <div
                      className={`w-3.5 h-3.5 rounded-full border-[1.5px] flex items-center justify-center ${exportSettings.loop ? "border-accent" : "border-white/20"}`}
                    >
                      {exportSettings.loop && (
                        <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                      )}
                    </div>
                  </button>
                </div>
              </div>

              {/* Embed Glyphs */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium text-muted uppercase tracking-widest">
                  Embed Glyphs
                </label>
                <button
                  onClick={() =>
                    setExportSettings((prev) => ({
                      ...prev,
                      embedGlyphs: !prev.embedGlyphs,
                    }))
                  }
                  className={`w-full flex items-center justify-between rounded-md px-3 py-2 text-sm border transition-all ${
                    exportSettings.embedGlyphs
                      ? "text-accent border-accent/30"
                      : "text-muted border-white/10 hover:border-white/20"
                  }`}
                  style={{ background: "var(--bg-surface)" }}
                >
                  <span>{exportSettings.embedGlyphs ? "On" : "Off"}</span>
                  <div
                    className={`w-3.5 h-3.5 rounded-full border-[1.5px] flex items-center justify-center ${exportSettings.embedGlyphs ? "border-accent" : "border-white/20"}`}
                  >
                    {exportSettings.embedGlyphs && (
                      <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                    )}
                  </div>
                </button>
                {exportSettings.embedGlyphs && (
                  <div className="flex items-start gap-1.5 mt-1.5 px-1">
                    <AlertTriangle size={11} className="text-yellow-400/80 mt-0.5 shrink-0" />
                    <p className="text-[10px] text-yellow-400/80 leading-relaxed">
                      Glyph export removes text editability at runtime
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Modal footer */}
            <div className="px-5 py-3 border-t border-white/[0.06] flex gap-2">
              <button
                onClick={() => setShowSettingsModal(false)}
                className="flex-1 h-8 rounded-md text-xs font-medium text-secondary hover:text-primary hover:bg-hover transition-colors border border-white/10"
              >
                Cancel
              </button>
              <button
                onClick={() => exportLottie()}
                className="flex-[2] h-8 rounded-md text-xs font-medium text-white transition-colors"
                style={{ background: "var(--accent)" }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "var(--accent-hover)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "var(--accent)")
                }
              >
                Download
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
