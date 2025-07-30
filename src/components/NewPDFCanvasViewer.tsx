import React, { useRef, useEffect, useState } from "react";
import { pdfjs } from "react-pdf";
import { polygon as turfPolygon } from "@turf/helpers";
import difference from "@turf/difference";
import { Feature, Polygon as TurfPolygon } from "geojson";
import booleanIntersects from "@turf/boolean-intersects";
import booleanContains from "@turf/boolean-contains";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

interface Point {
  x: number;
  y: number;
}

const SNAP_THRESHOLD = 10;

const NewPDFPolygonDrawer: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<any>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [currentPolygon, setCurrentPolygon] = useState<Point[]>([]);
  const [zones, setZones] = useState<Point[][][]>([]);
  const [history, setHistory] = useState<Point[][][][]>([]);
  const [redoStack, setRedoStack] = useState<Point[][][][]>([]);

  useEffect(() => {
    const loadPDF = async () => {
      const loadingTask = pdfjs.getDocument("Sample Floor Plan (PDF).pdf");
      const pdf = await loadingTask.promise;
      setPdfDoc(pdf);
      await renderPDFPage(pdf, [], []);
    };
    loadPDF();
  }, []);

  useEffect(() => {
    if (pdfDoc) {
      renderPDFPage(pdfDoc, zones, currentPolygon);
    }
  }, [zones, currentPolygon]);

  const renderPDFPage = async (pdf: any, polygons: Point[][][], current: Point[]) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1.5 });

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    if (renderTaskRef.current) renderTaskRef.current.cancel();
    const renderTask = page.render({ canvasContext: ctx, viewport });
    renderTaskRef.current = renderTask;

    try {
      await renderTask.promise;
      polygons.forEach((polygon) => {
        drawPolygon(ctx, polygon, "rgba(71, 145, 170, 0.4)", "#4682B4");
      });

      if (current.length > 1) {
        drawPolygon(ctx, [current], "rgba(0,0,0,0)", "#4682B4", false);
      }

      current.forEach((p) => drawPoint(ctx, p, "red"));
    } catch (err: unknown) {
      const error = err as { name?: string };
      if (error.name === "RenderingCancelledException") {
        console.warn("Render cancelled");
      } else {
        console.error("Render error:", err);
      }
    }
  };

  const drawPolygon = (ctx: CanvasRenderingContext2D, polygon: Point[][], fill: string, stroke: string, close: boolean = true) => {
    if (!polygon.length || polygon[0].length < 2) return;
    ctx.beginPath();
    for (let ring of polygon) {
      if (ring.length < 2) continue;
      ctx.moveTo(ring[0].x, ring[0].y);
      for (let i = 1; i < ring.length; i++) {
        ctx.lineTo(ring[i].x, ring[i].y);
      }
      if (close) ctx.closePath();
    }
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.fill("evenodd");
    ctx.stroke();
  };

  const drawPoint = (ctx: CanvasRenderingContext2D, point: Point, color: string) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
  };

  const isCloseToStart = (start: Point, current: Point) => {
    const dx = start.x - current.x;
    const dy = start.y - current.y;
    return Math.sqrt(dx * dx + dy * dy) < 10;
  };

  const distance = (a: Point, b: Point) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

  const getSnappedPoint = (point: Point): Point => {
    let nearest: Point | null = null;
    let minDist = SNAP_THRESHOLD;
    for (const zone of zones) {
      for (const ring of zone) {
        for (let i = 0; i < ring.length; i++) {
          const vertex = ring[i];
          const d = distance(point, vertex);
          if (d < minDist) {
            minDist = d;
            nearest = vertex;
          }
        }
      }
    }
    if (nearest) {
      const dx = point.x - nearest.x;
      const dy = point.y - nearest.y;
      const length = Math.sqrt(dx * dx + dy * dy) || 1;
      const offset = 1;
      return {
        x: nearest.x + (dx / length) * offset,
        y: nearest.y + (dy / length) * offset,
      };
    }
    return point;
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    let rawPoint = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    const snapped = getSnappedPoint(rawPoint);
    if (currentPolygon.length >= 3 && isCloseToStart(currentPolygon[0], snapped)) {
      handleClosePolygon();
    } else {
      setCurrentPolygon([...currentPolygon, snapped]);
    }
  };

  const handleCanvasDoubleClick = () => {
    if (currentPolygon.length >= 3) {
      handleClosePolygon();
    }
  };

  const handleClosePolygon = () => {
    let coords = currentPolygon.map((p) => [+p.x.toFixed(2), +p.y.toFixed(2)]);
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) coords.push([...first]);
    const newTurf = turfPolygon([coords]);
    let updatedZones: Point[][][] = [];
    let overlapHandled = false;

    for (let zone of zones) {
      const flatOuter = zone[0].map((p) => [+p.x.toFixed(2), +p.y.toFixed(2)]);
      if (flatOuter[0][0] !== flatOuter[flatOuter.length - 1][0] || flatOuter[0][1] !== flatOuter[flatOuter.length - 1][1]) {
        flatOuter.push([...flatOuter[0]]);
      }
      const holes = zone.slice(1).map(h => h.map((p) => [+p.x.toFixed(2), +p.y.toFixed(2)]));
      const existingTurf = turfPolygon([flatOuter, ...holes]);

      if (booleanContains(existingTurf, newTurf)) {
        // Append the new hole
        const newHoles = [...holes, coords];
        const updatedZone: Point[][] = [
          flatOuter.map(([x, y]) => ({ x, y })),
          ...newHoles.map(hole => hole.map(([x, y]) => ({ x, y })))
        ];
        updatedZones.push(updatedZone);
        overlapHandled = true;
      } else if (booleanIntersects(existingTurf, newTurf)) {
        // Subtract the new polygon from the existing one
        const clipped = difference(existingTurf, newTurf) as Feature<TurfPolygon>;
        if (clipped?.geometry?.coordinates.length) {
          const parts = clipped.geometry.coordinates.map(
            (ring) => ring.map(([x, y]) => ({ x, y }))
          );
          updatedZones.push(parts);
        }
        overlapHandled = true;
      } else {
        updatedZones.push(zone);
      }
    }

    if (!overlapHandled) {
      updatedZones.push([currentPolygon]);
    }

    setHistory([...history, zones]);
    setRedoStack([]);
    setZones(updatedZones);
    setCurrentPolygon([]);
  };


  const handleUndo = () => {
    if (history.length === 0) return;
    const previous = [...history[history.length - 1]];
    setHistory(history.slice(0, -1));
    setRedoStack([zones, ...redoStack]);
    setZones(previous);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = [...redoStack[0]];
    setRedoStack(redoStack.slice(1));
    setHistory([...history, zones]);
    setZones(next);
  };

  return (
    <div>
      <div style={{ padding: "10px", display: "flex", gap: "10px" }}>
        <button onClick={() => setCurrentPolygon([])}>Clear Current Polygon</button>
        <button onClick={handleUndo} disabled={history.length === 0}>Undo</button>
        <button onClick={handleRedo} disabled={redoStack.length === 0}>Redo</button>
        <button
  onClick={() => {
    const zoneData = zones.map((zone, idx) => {
      return {
        zoneIndex: idx,
        outer: zone[0],
        holes: zone.slice(1),
      };
    });
    console.log("Exported Zones JSON:\n", JSON.stringify(zoneData, null, 2));
  }}
>
  Export Zones
</button>

      </div>
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        onDoubleClick={handleCanvasDoubleClick}
        style={{ border: "1px solid gray", cursor: "crosshair" }}
      />
    </div>
  );
};

export default NewPDFPolygonDrawer;