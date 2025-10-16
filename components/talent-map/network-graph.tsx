"use client"

import type React from "react"

import { useEffect, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"

interface Node {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  type: "contributor" | "project"
  label: string
  connections: number
  size?: number
}

interface Edge {
  source: string
  target: string
}

interface TalentNetworkGraphProps {
  poolId: string
}

export function TalentNetworkGraph({ poolId }: TalentNetworkGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hoveredNode, setHoveredNode] = useState<Node | null>(null)
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])

  useEffect(() => {
    const networkData: Record<string, { nodes: Node[]; edges: Edge[] }> = {
      all: {
        nodes: [
          // Key contributors (appear in multiple projects)
          {
            id: "c1",
            x: 400,
            y: 200,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@alex-chen-dev",
            connections: 8,
            size: 12,
          },
          {
            id: "c2",
            x: 350,
            y: 150,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@sarah-kim",
            connections: 7,
            size: 11,
          },
          {
            id: "c3",
            x: 450,
            y: 250,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@jordan-lee",
            connections: 6,
            size: 10,
          },

          // ML cluster contributors
          {
            id: "c4",
            x: 200,
            y: 100,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@emma-zhang",
            connections: 5,
            size: 9,
          },
          {
            id: "c5",
            x: 180,
            y: 150,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@liam-patel",
            connections: 4,
            size: 8,
          },
          {
            id: "c6",
            x: 220,
            y: 180,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@ava-johnson",
            connections: 3,
            size: 7,
          },
          { id: "c7", x: 160, y: 120, vx: 0, vy: 0, type: "contributor", label: "@noah-kim", connections: 3, size: 7 },
          {
            id: "c8",
            x: 240,
            y: 140,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@mia-rodriguez",
            connections: 2,
            size: 6,
          },

          // Solana cluster contributors
          {
            id: "c9",
            x: 600,
            y: 150,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@sophia-martinez",
            connections: 5,
            size: 9,
          },
          {
            id: "c10",
            x: 650,
            y: 180,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@jackson-lee",
            connections: 4,
            size: 8,
          },
          {
            id: "c11",
            x: 620,
            y: 220,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@olivia-chen",
            connections: 3,
            size: 7,
          },
          { id: "c12", x: 680, y: 160, vx: 0, vy: 0, type: "contributor", label: "@ethan-wu", connections: 3, size: 7 },
          {
            id: "c13",
            x: 590,
            y: 200,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@isabella-garcia",
            connections: 2,
            size: 6,
          },

          // Inference cluster contributors
          {
            id: "c14",
            x: 350,
            y: 350,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@mason-park",
            connections: 5,
            size: 9,
          },
          {
            id: "c15",
            x: 400,
            y: 380,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@lucas-kim",
            connections: 4,
            size: 8,
          },
          {
            id: "c16",
            x: 320,
            y: 320,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@amelia-wang",
            connections: 3,
            size: 7,
          },
          {
            id: "c17",
            x: 380,
            y: 320,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@elijah-park",
            connections: 3,
            size: 7,
          },

          // Additional contributors (single project)
          {
            id: "c18",
            x: 140,
            y: 90,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@harper-lee",
            connections: 1,
            size: 5,
          },
          {
            id: "c19",
            x: 260,
            y: 110,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@evelyn-chen",
            connections: 1,
            size: 5,
          },
          {
            id: "c20",
            x: 190,
            y: 200,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@benjamin-wu",
            connections: 1,
            size: 5,
          },
          {
            id: "c21",
            x: 640,
            y: 130,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@charlotte-kim",
            connections: 1,
            size: 5,
          },
          {
            id: "c22",
            x: 700,
            y: 190,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@james-park",
            connections: 1,
            size: 5,
          },
          {
            id: "c23",
            x: 610,
            y: 250,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@aria-zhang",
            connections: 1,
            size: 5,
          },
          {
            id: "c24",
            x: 330,
            y: 390,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@sebastian-lee",
            connections: 1,
            size: 5,
          },
          {
            id: "c25",
            x: 420,
            y: 360,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@luna-martinez",
            connections: 1,
            size: 5,
          },

          // Projects (10 total representing 10 scrapes)
          {
            id: "p1",
            x: 200,
            y: 140,
            vx: 0,
            vy: 0,
            type: "project",
            label: "pytorch/pytorch",
            connections: 8,
            size: 10,
          },
          {
            id: "p2",
            x: 250,
            y: 160,
            vx: 0,
            vy: 0,
            type: "project",
            label: "huggingface/transformers",
            connections: 7,
            size: 9,
          },
          { id: "p3", x: 300, y: 180, vx: 0, vy: 0, type: "project", label: "openai/whisper", connections: 5, size: 8 },
          {
            id: "p4",
            x: 640,
            y: 180,
            vx: 0,
            vy: 0,
            type: "project",
            label: "solana-labs/solana",
            connections: 7,
            size: 10,
          },
          {
            id: "p5",
            x: 620,
            y: 210,
            vx: 0,
            vy: 0,
            type: "project",
            label: "coral-xyz/anchor",
            connections: 6,
            size: 8,
          },
          {
            id: "p6",
            x: 660,
            y: 160,
            vx: 0,
            vy: 0,
            type: "project",
            label: "metaplex-foundation/metaplex",
            connections: 4,
            size: 7,
          },
          {
            id: "p7",
            x: 360,
            y: 340,
            vx: 0,
            vy: 0,
            type: "project",
            label: "vllm-project/vllm",
            connections: 8,
            size: 10,
          },
          {
            id: "p8",
            x: 380,
            y: 300,
            vx: 0,
            vy: 0,
            type: "project",
            label: "NVIDIA/TensorRT-LLM",
            connections: 6,
            size: 8,
          },
          {
            id: "p9",
            x: 320,
            y: 360,
            vx: 0,
            vy: 0,
            type: "project",
            label: "ggerganov/llama.cpp",
            connections: 5,
            size: 8,
          },
          {
            id: "p10",
            x: 280,
            y: 200,
            vx: 0,
            vy: 0,
            type: "project",
            label: "facebookresearch/llama",
            connections: 4,
            size: 7,
          },
        ],
        edges: [
          // Key contributors (cross-project talent)
          { source: "c1", target: "p1" },
          { source: "c1", target: "p2" },
          { source: "c1", target: "p7" },
          { source: "c1", target: "p8" },
          { source: "c2", target: "p1" },
          { source: "c2", target: "p3" },
          { source: "c2", target: "p7" },
          { source: "c3", target: "p7" },
          { source: "c3", target: "p8" },
          { source: "c3", target: "p9" },

          // ML cluster
          { source: "c4", target: "p1" },
          { source: "c4", target: "p2" },
          { source: "c5", target: "p1" },
          { source: "c5", target: "p10" },
          { source: "c6", target: "p2" },
          { source: "c6", target: "p3" },
          { source: "c7", target: "p1" },
          { source: "c8", target: "p2" },
          { source: "c18", target: "p1" },
          { source: "c19", target: "p3" },
          { source: "c20", target: "p10" },

          // Solana cluster
          { source: "c9", target: "p4" },
          { source: "c9", target: "p5" },
          { source: "c10", target: "p4" },
          { source: "c10", target: "p6" },
          { source: "c11", target: "p5" },
          { source: "c11", target: "p6" },
          { source: "c12", target: "p4" },
          { source: "c13", target: "p5" },
          { source: "c21", target: "p4" },
          { source: "c22", target: "p6" },
          { source: "c23", target: "p5" },

          // Inference cluster
          { source: "c14", target: "p7" },
          { source: "c14", target: "p8" },
          { source: "c15", target: "p7" },
          { source: "c15", target: "p9" },
          { source: "c16", target: "p8" },
          { source: "c16", target: "p9" },
          { source: "c17", target: "p7" },
          { source: "c24", target: "p9" },
          { source: "c25", target: "p8" },
        ],
      },
      "ml-engineer": {
        nodes: [
          // Key ML contributors
          {
            id: "c1",
            x: 350,
            y: 200,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@alex-chen-dev",
            connections: 4,
            size: 11,
          },
          {
            id: "c2",
            x: 300,
            y: 150,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@sarah-kim",
            connections: 3,
            size: 10,
          },
          {
            id: "c4",
            x: 250,
            y: 180,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@emma-zhang",
            connections: 5,
            size: 12,
          },
          {
            id: "c5",
            x: 280,
            y: 220,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@liam-patel",
            connections: 4,
            size: 11,
          },
          {
            id: "c6",
            x: 320,
            y: 240,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@ava-johnson",
            connections: 3,
            size: 9,
          },
          { id: "c7", x: 220, y: 160, vx: 0, vy: 0, type: "contributor", label: "@noah-kim", connections: 3, size: 9 },
          {
            id: "c8",
            x: 350,
            y: 260,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@mia-rodriguez",
            connections: 2,
            size: 8,
          },
          {
            id: "c18",
            x: 200,
            y: 140,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@harper-lee",
            connections: 1,
            size: 6,
          },
          {
            id: "c19",
            x: 380,
            y: 180,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@evelyn-chen",
            connections: 1,
            size: 6,
          },
          {
            id: "c20",
            x: 260,
            y: 280,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@benjamin-wu",
            connections: 1,
            size: 6,
          },

          // ML Projects
          {
            id: "p1",
            x: 280,
            y: 180,
            vx: 0,
            vy: 0,
            type: "project",
            label: "pytorch/pytorch",
            connections: 8,
            size: 11,
          },
          {
            id: "p2",
            x: 320,
            y: 200,
            vx: 0,
            vy: 0,
            type: "project",
            label: "huggingface/transformers",
            connections: 7,
            size: 10,
          },
          { id: "p3", x: 300, y: 240, vx: 0, vy: 0, type: "project", label: "openai/whisper", connections: 5, size: 9 },
          {
            id: "p10",
            x: 260,
            y: 220,
            vx: 0,
            vy: 0,
            type: "project",
            label: "facebookresearch/llama",
            connections: 4,
            size: 8,
          },
        ],
        edges: [
          { source: "c1", target: "p1" },
          { source: "c1", target: "p2" },
          { source: "c2", target: "p1" },
          { source: "c2", target: "p3" },
          { source: "c4", target: "p1" },
          { source: "c4", target: "p2" },
          { source: "c5", target: "p1" },
          { source: "c5", target: "p10" },
          { source: "c6", target: "p2" },
          { source: "c6", target: "p3" },
          { source: "c7", target: "p1" },
          { source: "c8", target: "p2" },
          { source: "c18", target: "p1" },
          { source: "c19", target: "p3" },
          { source: "c20", target: "p10" },
        ],
      },
      "solana-engineer": {
        nodes: [
          // Solana contributors
          {
            id: "c9",
            x: 350,
            y: 180,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@sophia-martinez",
            connections: 5,
            size: 11,
          },
          {
            id: "c10",
            x: 400,
            y: 200,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@jackson-lee",
            connections: 4,
            size: 10,
          },
          {
            id: "c11",
            x: 320,
            y: 240,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@olivia-chen",
            connections: 3,
            size: 9,
          },
          { id: "c12", x: 420, y: 160, vx: 0, vy: 0, type: "contributor", label: "@ethan-wu", connections: 3, size: 9 },
          {
            id: "c13",
            x: 300,
            y: 200,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@isabella-garcia",
            connections: 2,
            size: 8,
          },
          {
            id: "c21",
            x: 380,
            y: 140,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@charlotte-kim",
            connections: 1,
            size: 6,
          },
          {
            id: "c22",
            x: 440,
            y: 190,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@james-park",
            connections: 1,
            size: 6,
          },
          {
            id: "c23",
            x: 310,
            y: 270,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@aria-zhang",
            connections: 1,
            size: 6,
          },

          // Solana Projects
          {
            id: "p4",
            x: 370,
            y: 190,
            vx: 0,
            vy: 0,
            type: "project",
            label: "solana-labs/solana",
            connections: 7,
            size: 10,
          },
          {
            id: "p5",
            x: 340,
            y: 220,
            vx: 0,
            vy: 0,
            type: "project",
            label: "coral-xyz/anchor",
            connections: 6,
            size: 9,
          },
          {
            id: "p6",
            x: 400,
            y: 170,
            vx: 0,
            vy: 0,
            type: "project",
            label: "metaplex-foundation/metaplex",
            connections: 4,
            size: 8,
          },
        ],
        edges: [
          { source: "c9", target: "p4" },
          { source: "c9", target: "p5" },
          { source: "c10", target: "p4" },
          { source: "c10", target: "p6" },
          { source: "c11", target: "p5" },
          { source: "c11", target: "p6" },
          { source: "c12", target: "p4" },
          { source: "c13", target: "p5" },
          { source: "c21", target: "p4" },
          { source: "c22", target: "p6" },
          { source: "c23", target: "p5" },
        ],
      },
      "inference-ops": {
        nodes: [
          // Inference contributors (including cross-project talent)
          {
            id: "c1",
            x: 350,
            y: 180,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@alex-chen-dev",
            connections: 4,
            size: 11,
          },
          {
            id: "c3",
            x: 400,
            y: 220,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@jordan-lee",
            connections: 3,
            size: 10,
          },
          {
            id: "c14",
            x: 300,
            y: 200,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@mason-park",
            connections: 5,
            size: 11,
          },
          {
            id: "c15",
            x: 380,
            y: 260,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@lucas-kim",
            connections: 4,
            size: 10,
          },
          {
            id: "c16",
            x: 280,
            y: 240,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@amelia-wang",
            connections: 3,
            size: 9,
          },
          {
            id: "c17",
            x: 360,
            y: 240,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@elijah-park",
            connections: 3,
            size: 9,
          },
          {
            id: "c24",
            x: 320,
            y: 280,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@sebastian-lee",
            connections: 1,
            size: 6,
          },
          {
            id: "c25",
            x: 420,
            y: 240,
            vx: 0,
            vy: 0,
            type: "contributor",
            label: "@luna-martinez",
            connections: 1,
            size: 6,
          },

          // Inference Projects
          {
            id: "p7",
            x: 340,
            y: 220,
            vx: 0,
            vy: 0,
            type: "project",
            label: "vllm-project/vllm",
            connections: 8,
            size: 11,
          },
          {
            id: "p8",
            x: 370,
            y: 200,
            vx: 0,
            vy: 0,
            type: "project",
            label: "NVIDIA/TensorRT-LLM",
            connections: 6,
            size: 9,
          },
          {
            id: "p9",
            x: 310,
            y: 250,
            vx: 0,
            vy: 0,
            type: "project",
            label: "ggerganov/llama.cpp",
            connections: 5,
            size: 8,
          },
        ],
        edges: [
          { source: "c1", target: "p7" },
          { source: "c1", target: "p8" },
          { source: "c3", target: "p7" },
          { source: "c3", target: "p8" },
          { source: "c3", target: "p9" },
          { source: "c14", target: "p7" },
          { source: "c14", target: "p8" },
          { source: "c15", target: "p7" },
          { source: "c15", target: "p9" },
          { source: "c16", target: "p8" },
          { source: "c16", target: "p9" },
          { source: "c17", target: "p7" },
          { source: "c24", target: "p9" },
          { source: "c25", target: "p8" },
        ],
      },
    }

    const data = networkData[poolId] || networkData.all
    setNodes(data.nodes)
    setEdges(data.edges)
  }, [poolId])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()

    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr

    ctx.scale(dpr, dpr)
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`

    // Clear canvas
    ctx.clearRect(0, 0, rect.width, rect.height)

    // Draw edges
    ctx.strokeStyle = "rgba(139, 92, 246, 0.15)"
    ctx.lineWidth = 1
    edges.forEach((edge) => {
      const sourceNode = nodes.find((n) => n.id === edge.source)
      const targetNode = nodes.find((n) => n.id === edge.target)
      if (sourceNode && targetNode) {
        ctx.beginPath()
        ctx.moveTo(sourceNode.x, sourceNode.y)
        ctx.lineTo(targetNode.x, targetNode.y)
        ctx.stroke()
      }
    })

    // Draw nodes
    nodes.forEach((node) => {
      const isHovered = hoveredNode?.id === node.id
      const radius = node.size || (node.type === "contributor" ? 6 : 5)

      // Glow effect for hovered node
      if (isHovered) {
        ctx.shadowBlur = 20
        ctx.shadowColor = "rgba(139, 92, 246, 0.8)"
      }

      // Node circle
      ctx.beginPath()
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2)
      const opacity = node.type === "contributor" ? 0.9 : 0.7
      ctx.fillStyle = node.type === "contributor" ? `rgba(139, 92, 246, ${opacity})` : `rgba(34, 211, 238, ${opacity})`
      ctx.fill()

      // Border
      ctx.strokeStyle = node.type === "contributor" ? "rgba(139, 92, 246, 1)" : "rgba(34, 211, 238, 1)"
      ctx.lineWidth = isHovered ? 2 : 1
      ctx.stroke()

      ctx.shadowBlur = 0
    })
  }, [nodes, edges, hoveredNode])

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const hoveredNode = nodes.find((node) => {
      const dx = node.x - x
      const dy = node.y - y
      const distance = Math.sqrt(dx * dx + dy * dy)
      const radius = node.size || 8
      return distance < radius + 2
    })

    setHoveredNode(hoveredNode || null)
  }

  return (
    <div className="relative z-10 overflow-hidden isolate">
      <canvas
        ref={canvasRef}
        className="w-full h-[250px] cursor-pointer relative z-10"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredNode(null)}
      />

      {hoveredNode && (
        <div className="absolute top-2 right-4 bg-card/90 backdrop-blur border border-border rounded-lg p-3 shadow-lg z-20">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={hoveredNode.type === "contributor" ? "default" : "secondary"} className="text-xs">
              {hoveredNode.type}
            </Badge>
            <span className="font-medium text-sm">{hoveredNode.label}</span>
          </div>
          <div className="text-xs text-muted-foreground">{hoveredNode.connections} connections</div>
        </div>
      )}

      <div className="flex items-center gap-4 mt-2 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-primary" />
          <span className="text-muted-foreground">Contributors</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-cyan-400" />
          <span className="text-muted-foreground">Projects</span>
        </div>
        <div className="text-muted-foreground ml-auto">Larger nodes = more connections</div>
      </div>
    </div>
  )
}
