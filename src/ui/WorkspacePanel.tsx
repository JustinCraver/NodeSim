import type { ReactNode } from 'react';

type WorkspacePanelProps = {
  title: string;
  isClosable?: boolean;
  bodyClassName?: string;
  children: ReactNode;
  onClose?: () => void;
};

export const WorkspacePanel = ({ title, isClosable, bodyClassName, children, onClose }: WorkspacePanelProps) => (
  <section className="workspace-panel">
    <div className="workspace-panel-header">
      <div className="workspace-panel-title">
        <span className="workspace-panel-grip" aria-hidden="true">
          ::
        </span>
        <h2>{title}</h2>
      </div>
      {isClosable && (
        <button type="button" className="workspace-panel-close" aria-label={`Close ${title}`} onClick={onClose}>
          x
        </button>
      )}
    </div>
    <div className={['workspace-panel-body', bodyClassName].filter(Boolean).join(' ')}>{children}</div>
  </section>
);
