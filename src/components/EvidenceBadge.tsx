import type { EvidenceKind } from '../types/ReviewBrief'

interface Props {
  kind: EvidenceKind
}

const labels: Record<EvidenceKind, string> = {
  fact: 'Fact',
  inference: 'Inferred',
  unknown: 'Unknown',
}

export function EvidenceBadge({ kind }: Props) {
  return (
    <span className={`badge badge-${kind}`} aria-label={`Evidence kind: ${labels[kind]}`}>
      {labels[kind]}
    </span>
  )
}
