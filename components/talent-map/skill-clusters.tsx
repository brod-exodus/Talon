"use client"

interface SkillCluster {
  name: string
  count: number
  color: string
  size: number
  x: number
  y: number
}

export function SkillClusters() {
  const clusters: SkillCluster[] = [
    { name: "LLM Inference", count: 234, color: "rgba(139, 92, 246, 0.8)", size: 110, x: 200, y: 130 },
    { name: "Systems", count: 189, color: "rgba(34, 211, 238, 0.8)", size: 95, x: 350, y: 150 },
    { name: "ML Ops", count: 156, color: "rgba(251, 146, 60, 0.8)", size: 82, x: 150, y: 190 },
    { name: "Distributed", count: 143, color: "rgba(248, 113, 113, 0.8)", size: 78, x: 320, y: 210 },
    { name: "Optimization", count: 98, color: "rgba(167, 139, 250, 0.8)", size: 62, x: 250, y: 170 },
    { name: "GPU/CUDA", count: 87, color: "rgba(74, 222, 128, 0.8)", size: 58, x: 280, y: 230 },
  ]

  return (
    <svg className="w-full h-[300px]">
      {clusters.map((cluster, i) => (
        <g key={cluster.name}>
          {/* Cluster circle */}
          <circle
            cx={cluster.x}
            cy={cluster.y}
            r={cluster.size}
            fill={cluster.color}
            opacity={0.2}
            className="transition-all hover:opacity-30 cursor-pointer"
          />
          <circle
            cx={cluster.x}
            cy={cluster.y}
            r={cluster.size}
            fill="none"
            stroke={cluster.color}
            strokeWidth={2}
            opacity={0.6}
          />

          {/* Label */}
          <text x={cluster.x} y={cluster.y - 5} textAnchor="middle" className="text-xs font-medium fill-foreground">
            {cluster.name}
          </text>
          <text x={cluster.x} y={cluster.y + 10} textAnchor="middle" className="text-xs fill-muted-foreground">
            {cluster.count} contributors
          </text>
        </g>
      ))}
    </svg>
  )
}
