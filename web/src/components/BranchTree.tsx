import React from 'react';
import type { KifBranch, KifTreeNode } from '../lib/kif-parser';

interface BranchTreeProps {
  branches: KifBranch[];
  tree: KifTreeNode[];
  activeBranchId: number;
  onSelectBranch: (branchId: number) => void;
}

/** Compact tree diagram for switching between KIF branches */
const BranchTree: React.FC<BranchTreeProps> = ({
  branches,
  tree,
  activeBranchId,
  onSelectBranch,
}) => {
  if (branches.length <= 1) return null;

  return (
    <div className="border border-gray-200 rounded bg-gray-50 p-2">
      <div className="text-[10px] font-semibold text-gray-500 mb-1">分岐ツリー</div>
      <div className="overflow-x-auto">
        <TreeNodeList
          nodes={tree}
          activeBranchId={activeBranchId}
          onSelectBranch={onSelectBranch}
          depth={0}
        />
      </div>
      <div className="flex flex-wrap gap-1 mt-1.5 pt-1.5 border-t border-gray-200">
        {branches.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onSelectBranch(b.id)}
            className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
              b.id === activeBranchId
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-blue-50'
            }`}
          >
            {b.name}（{b.moves.length}手）
          </button>
        ))}
      </div>
    </div>
  );
};

const TreeNodeList: React.FC<{
  nodes: KifTreeNode[];
  activeBranchId: number;
  onSelectBranch: (branchId: number) => void;
  depth: number;
}> = ({ nodes, activeBranchId, onSelectBranch, depth }) => {
  if (nodes.length === 0) return null;

  // Group consecutive nodes on the same branch into a run
  const runs: Array<{ branchId: number; nodes: KifTreeNode[] }> = [];
  for (const node of nodes) {
    const last = runs[runs.length - 1];
    if (last && last.branchId === node.branchId) {
      last.nodes.push(node);
    } else {
      runs.push({ branchId: node.branchId, nodes: [node] });
    }
  }

  // If there's only one run and it's a straight line, render inline
  if (runs.length === 1) {
    const run = runs[0];
    const lastNode = run.nodes[run.nodes.length - 1];
    return (
      <div className="flex items-start gap-0">
        <RunDisplay
          run={run}
          activeBranchId={activeBranchId}
          onSelectBranch={onSelectBranch}
        />
        {lastNode.children.length > 0 && (
          <TreeNodeList
            nodes={lastNode.children}
            activeBranchId={activeBranchId}
            onSelectBranch={onSelectBranch}
            depth={depth}
          />
        )}
      </div>
    );
  }

  // Multiple runs = branch point: show them vertically
  return (
    <div className="flex flex-col gap-0.5">
      {runs.map((run, idx) => {
        const lastNode = run.nodes[run.nodes.length - 1];
        return (
          <div key={`${run.branchId}-${idx}`} className="flex items-start gap-0">
            {idx > 0 && (
              <span className="text-gray-400 text-[10px] mr-0.5 leading-[18px]">└</span>
            )}
            <RunDisplay
              run={run}
              activeBranchId={activeBranchId}
              onSelectBranch={onSelectBranch}
            />
            {lastNode.children.length > 0 && (
              <TreeNodeList
                nodes={lastNode.children}
                activeBranchId={activeBranchId}
                onSelectBranch={onSelectBranch}
                depth={depth + 1}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

const RunDisplay: React.FC<{
  run: { branchId: number; nodes: KifTreeNode[] };
  activeBranchId: number;
  onSelectBranch: (branchId: number) => void;
}> = ({ run, activeBranchId, onSelectBranch }) => {
  const isActive = run.branchId === activeBranchId;
  const first = run.nodes[0];
  const last = run.nodes[run.nodes.length - 1];

  return (
    <button
      type="button"
      onClick={() => onSelectBranch(run.branchId)}
      className={`flex items-center gap-0.5 px-1 py-0 rounded text-[9px] font-mono whitespace-nowrap border transition-colors ${
        isActive
          ? 'bg-blue-100 border-blue-400 text-blue-800'
          : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-100'
      }`}
      title={run.nodes.map((n) => `${n.moveNumber}. ${n.label}`).join('\n')}
    >
      <span>{first.moveNumber}</span>
      {run.nodes.length > 1 && (
        <>
          <span className="text-gray-400">-</span>
          <span>{last.moveNumber}</span>
        </>
      )}
      <span className="ml-0.5">{first.label.slice(0, 4)}</span>
      {run.nodes.length > 1 && <span className="text-gray-400">…</span>}
    </button>
  );
};

export default BranchTree;
