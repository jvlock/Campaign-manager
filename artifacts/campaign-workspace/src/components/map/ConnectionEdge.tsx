import { BezierEdge, type EdgeProps } from '@xyflow/react';

/**
 * Keep the rendered connection light while giving pointer and touch users a
 * generous hit target. The larger interaction width is intentionally
 * independent from the visible stroke width.
 */
export default function ConnectionEdge(props: EdgeProps) {
  return (
    <BezierEdge
      {...props}
      interactionWidth={36}
      style={{
        ...props.style,
        strokeWidth: props.selected ? 3 : 2,
      }}
    />
  );
}