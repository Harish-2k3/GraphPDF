import React, { useRef, useState, useEffect } from 'react';
import { pdfjs } from 'react-pdf';
import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api';

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

interface Point {
  x: number;
  y: number;
}

interface Shape {
  polygonIndex: number;
  type: 'rectangle' | 'circle' | 'triangle';
  rect: { x: number; y: number; width: number; height: number };
}

interface EditorState {
  polygons: Point[][];
  currentPolygon: Point[];
  shapes: Shape[];
}


type Mode = 'none' | 'polygon' | 'shape' | 'select';

export default function PDFCanvasViewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [mode, setMode] = useState<Mode>('none');
  const [shapeType, setShapeType] = useState<'rectangle' | 'circle' | 'triangle'>('rectangle');

  const [polygons, setPolygons] = useState<Point[][]>([]);
  const [currentPolygon, setCurrentPolygon] = useState<Point[]>([]);

  const [shapes, setShapes] = useState<Shape[]>([]);
  const [selectedShapeIndex, setSelectedShapeIndex] = useState<number | null>(null);
  const [dragStart, setDragStart] = useState<Point | null>(null);

  const [undoStack, setUndoStack] = useState<EditorState[]>([]);
  const [redoStack, setRedoStack] = useState<EditorState[]>([]);

  const [resizingShape, setResizingShape] = useState<{
    shapeIndex: number;
    corner: 'tl' | 'tr' | 'bl' | 'br';
  } | null>(null);

  const loadPdf = async (file: File) => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    setPdfDoc(pdf);
  };

  const saveToUndoStack = () => {
    setUndoStack((prev) => [
      ...prev,
      {
        polygons: polygons.map(p => [...p]),
        currentPolygon: [...currentPolygon],
        shapes: shapes.map(s => ({ ...s, rect: { ...s.rect } })),
      },
    ]);
    setRedoStack([]);
  };


  const handleUndo = () => {
    if (undoStack.length === 0) return;
    setRedoStack((prev) => [...prev, { polygons, currentPolygon, shapes }]);
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((prevStack) => prevStack.slice(0, -1));
    setPolygons(prev.polygons);
    setCurrentPolygon(prev.currentPolygon);
    setShapes(prev.shapes);
  };



  const handleRedo = () => {
    if (redoStack.length === 0) return;
    setUndoStack((prev) => [...prev, { polygons, currentPolygon, shapes }]);
    const next = redoStack[redoStack.length - 1];
    setRedoStack((prevStack) => prevStack.slice(0, -1));
    setPolygons(next.polygons);
    setCurrentPolygon(next.currentPolygon);
    setShapes(next.shapes);
  };

  const renderTaskRef = useRef<any>(null);

  const renderPage = async () => {
    if (!pdfDoc || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const page: PDFPageProxy = await pdfDoc.getPage(1);
    const viewport = page.getViewport({ scale: 1.5 });

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    // Cancel previous render task if in progress
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel(); // cancel the old one
    }

    const renderContext = {
      canvasContext: ctx,
      viewport,
    };

    const renderTask = page.render(renderContext);
    renderTaskRef.current = renderTask;

    try {
      await renderTask.promise;
      drawPolygons(ctx);
    } catch (error) {
      if ((error as Error).name !== 'RenderingCancelledException') {
        console.error('Render error:', error);
      }
    }
  };


  const drawPolygons = (ctx: CanvasRenderingContext2D) => {
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'red';
    ctx.fillStyle = 'blue';

    polygons.forEach((polygon, polygonIndex) => {
      if (polygon.length === 0) return;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(polygon[0].x, polygon[0].y);
      for (let i = 1; i < polygon.length; i++) {
        ctx.lineTo(polygon[i].x, polygon[i].y);
      }
      ctx.closePath();

      // Light shade fill
      ctx.fillStyle = 'rgba(173, 216, 230, 0.3)';
      ctx.fill();

      ctx.clip();

      // Clear inner shape areas
      shapes
        .filter((shape) => shape.polygonIndex === polygonIndex)
        .forEach((shape) => {
          const { rect } = shape;
          ctx.clearRect(rect.x, rect.y, rect.width, rect.height);
        });

      ctx.restore();

      // Draw polygon outline
      ctx.beginPath();
      ctx.moveTo(polygon[0].x, polygon[0].y);
      for (let i = 1; i < polygon.length; i++) {
        ctx.lineTo(polygon[i].x, polygon[i].y);
      }
      ctx.closePath();
      ctx.stroke();

      // Draw points
      polygon.forEach((pt) => {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4, 0, 2 * Math.PI);
        ctx.fill();
      });
    });

    // Draw shapes
    shapes.forEach((shape, i) => {
      const { rect, type } = shape;
      ctx.beginPath();
      ctx.strokeStyle = selectedShapeIndex === i ? 'orange' : 'green';

      if (type === 'rectangle') {
        ctx.rect(rect.x, rect.y, rect.width, rect.height);
      } else if (type === 'circle') {
        ctx.ellipse(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width / 2, rect.height / 2, 0, 0, Math.PI * 2);
      } else if (type === 'triangle') {
        ctx.moveTo(rect.x + rect.width / 2, rect.y);
        ctx.lineTo(rect.x, rect.y + rect.height);
        ctx.lineTo(rect.x + rect.width, rect.y + rect.height);
        ctx.closePath();
      }

      ctx.stroke();

      // Resize handles
      const corners = [
        [rect.x, rect.y],
        [rect.x + rect.width, rect.y],
        [rect.x, rect.y + rect.height],
        [rect.x + rect.width, rect.y + rect.height],
      ];
      corners.forEach(([cx, cy]) => {
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, 2 * Math.PI);
        ctx.fillStyle = 'orange';
        ctx.fill();
      });
    });

    // Draw current polygon in progress
    if (currentPolygon.length > 0) {
      ctx.beginPath();
      ctx.moveTo(currentPolygon[0].x, currentPolygon[0].y);
      for (let i = 1; i < currentPolygon.length; i++) {
        ctx.lineTo(currentPolygon[i].x, currentPolygon[i].y);
      }
      ctx.stroke();

      currentPolygon.forEach((pt) => {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4, 0, 2 * Math.PI);
        ctx.fill();
      });
    }
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const newPoint = { x, y };

    if (mode === 'shape') {
      if (!dragStart) {
        setDragStart(newPoint);
      } else {
        const newRect = {
          x: Math.min(dragStart.x, newPoint.x),
          y: Math.min(dragStart.y, newPoint.y),
          width: Math.abs(dragStart.x - newPoint.x),
          height: Math.abs(dragStart.y - newPoint.y),
        };
        const polygonIndex = polygons.length - 1;
        saveToUndoStack();
        setShapes((prev) => [...prev, { polygonIndex, type: shapeType, rect: newRect }]);
        setDragStart(null);
      }
      return;
    }

    if (mode === 'polygon') {
      if (
        currentPolygon.length > 0 &&
        Math.abs(currentPolygon[0].x - newPoint.x) < 6 &&
        Math.abs(currentPolygon[0].y - newPoint.y) < 6
      ) {
        // Closing polygon
        saveToUndoStack();
        const closed = [...currentPolygon, currentPolygon[0]];
        setPolygons((prev) => [...prev, closed]);
        setCurrentPolygon([]);
      } else {
        // Save each point add
        saveToUndoStack();
        setCurrentPolygon((prev) => [...prev, newPoint]);
      }
    }

  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (mode !== 'select' || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    for (let i = 0; i < shapes.length; i++) {
      const { x: rx, y: ry, width, height } = shapes[i].rect;
      if (x >= rx && x <= rx + width && y >= ry && y <= ry + height) {
        setSelectedShapeIndex(i);
        const handles = {
          tl: [rx, ry],
          tr: [rx + width, ry],
          bl: [rx, ry + height],
          br: [rx + width, ry + height],
        };
        for (let corner in handles) {
          const [cx, cy] = handles[corner as keyof typeof handles];
          if (Math.abs(cx - x) < 6 && Math.abs(cy - y) < 6) {
            setResizingShape({ shapeIndex: i, corner: corner as any });
            return;
          }
        }
        return;
      }
    }
    setSelectedShapeIndex(null);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!resizingShape || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    setShapes((prevShapes) => {
      const newShapes = [...prevShapes];
      const shape = { ...newShapes[resizingShape.shapeIndex] };
      let r = { ...shape.rect };
      switch (resizingShape.corner) {
        case 'tl': r.width += r.x - x; r.height += r.y - y; r.x = x; r.y = y; break;
        case 'tr': r.width = x - r.x; r.height += r.y - y; r.y = y; break;
        case 'bl': r.width += r.x - x; r.x = x; r.height = y - r.y; break;
        case 'br': r.width = x - r.x; r.height = y - r.y; break;
      }
      shape.rect = r;
      newShapes[resizingShape.shapeIndex] = shape;
      return newShapes;
    });
    renderPage();
  };

  const handleMouseUp = () => {
    if (resizingShape) {
      saveToUndoStack();
      setResizingShape(null);
    }
  };

  useEffect(() => {
    if (pdfDoc) renderPage();
  }, [pdfDoc, polygons, currentPolygon, shapes, selectedShapeIndex]);



  return (
    <div style={{ display: 'flex', gap: '20px', padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ flex: 1 }}>
        {/* Toolbar */}
        <div
          style={{
            marginBottom: '15px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flexWrap: 'wrap',
            backgroundColor: '#f9f9f9',
            padding: '10px 15px',
            borderRadius: '8px',
            boxShadow: '0 2px 5px rgba(0,0,0,0.1)'
          }}
        >
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                setPolygons([]);
                setCurrentPolygon([]);
                setShapes([]);
                loadPdf(file);
              }
            }}
          />
          <button
            onClick={() => setMode('polygon')}
            title="Draw Polygon"
            style={{
              backgroundColor: mode === 'polygon' ? '#007bff' : '#e0e0e0',
              color: mode === 'polygon' ? 'white' : 'black',
              padding: '6px 12px',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer'
            }}
          >
            ✏️ Polygon
          </button>

          <div>
            <button
              onClick={() => setMode('shape')}
              title="Draw Shape"
              style={{
                backgroundColor: mode === 'shape' ? '#007bff' : '#e0e0e0',
                color: mode === 'shape' ? 'white' : 'black',
                padding: '6px 12px',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer'
              }}
            >
              🟦 Shape
            </button>
            {mode === 'shape' && (
              <select
                value={shapeType}
                onChange={(e) => setShapeType(e.target.value as any)}
                style={{
                  marginLeft: '8px',
                  padding: '5px',
                  borderRadius: '4px',
                  border: '1px solid #ccc',
                }}
              >
                <option value="rectangle">Rectangle</option>
                <option value="circle">Circle</option>
                <option value="triangle">Triangle</option>
              </select>
            )}
          </div>

          <button
            onClick={() => setMode('select')}
            title="Select/Resize"
            style={{
              backgroundColor: mode === 'select' ? '#007bff' : '#e0e0e0',
              color: mode === 'select' ? 'white' : 'black',
              padding: '6px 12px',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer'
            }}
          >
            🖱️ Select
          </button>

          <button
            onClick={handleUndo}
            title="Undo"
            style={{
              padding: '6px 10px',
              backgroundColor: '#ffbdbd',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer'
            }}
          >
            ↩️ Undo
          </button>

          <button
            onClick={handleRedo}
            title="Redo"
            style={{
              padding: '6px 10px',
              backgroundColor: '#c0ffb3',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer'
            }}
          >
            ↪️ Redo
          </button>
        </div>

        {/* PDF Canvas */}
        <div
          style={{
            border: '1px solid #ccc',
            boxShadow: '0 3px 8px rgba(0, 0, 0, 0.15)',
            borderRadius: '8px',
            overflow: 'hidden',
            maxWidth: '100%',
          }}
        >
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            style={{ width: '100%', height: 'auto', display: 'block', cursor: 'crosshair' }}
          />
        </div>
      </div>

      {/* Overlay Panel */}
      <div
        style={{
          width: '300px',
          backgroundColor: 'white',
          border: '1px solid #ddd',
          borderRadius: '8px',
          padding: '15px',
          boxShadow: '0 3px 8px rgba(0,0,0,0.1)',
          overflowY: 'auto',
          maxHeight: '90vh'
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: '10px', fontSize: '16px' }}>🗂️ Polygon Info</h3>
        {[...polygons, currentPolygon].map((polygon, index) => {
          const uniquePoints = [...polygon];
          if (
            uniquePoints.length > 1 &&
            uniquePoints[0].x === uniquePoints[uniquePoints.length - 1].x &&
            uniquePoints[0].y === uniquePoints[uniquePoints.length - 1].y
          ) {
            uniquePoints.pop();
          }

          const shapesInPolygon = shapes.filter(s => s.polygonIndex === index);

          return (
            <div key={index} style={{ marginBottom: '15px', padding: '8px', border: '1px solid #eee', borderRadius: '5px' }}>
              <strong style={{ color: '#007bff' }}>Polygon {index + 1}</strong>
              <div style={{ marginTop: '5px' }}>
                <strong>Points:</strong>
                <ul style={{ paddingLeft: '20px', marginTop: '4px' }}>
                  {uniquePoints.map((pt, i) => (
                    <li key={i}>({pt.x.toFixed(0)}, {pt.y.toFixed(0)})</li>
                  ))}
                </ul>
              </div>
              {shapesInPolygon.length > 0 && (
                <div>
                  <strong>Shapes:</strong>
                  <ul style={{ paddingLeft: '20px' }}>
                    {shapesInPolygon.map((shape, i) => (
                      <li key={i}>
                        {shape.type}: ({shape.rect.x.toFixed(0)}, {shape.rect.y.toFixed(0)}) -
                        {shape.rect.width.toFixed(0)}x{shape.rect.height.toFixed(0)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
