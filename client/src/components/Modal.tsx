import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './Modal.css';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    children: React.ReactNode;
    className?: string;
    title?: string;
    showCloseButton?: boolean;
}

export const Modal: React.FC<ModalProps> = ({ 
    isOpen, 
    onClose, 
    children, 
    className, 
    title,
    showCloseButton = true
}) => {
    const modalRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };

        if (isOpen) {
            window.addEventListener('keydown', handleKeyDown);
            // Focus the modal for accessibility/keyboard nav
            modalRef.current?.focus();
        }

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return createPortal(
        <div 
            className="modal-root-overlay" 
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div 
                className={`modal-container ${className || ''}`} 
                ref={modalRef} 
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
            >
                {(title || showCloseButton) && (
                    <div className="modal-header">
                        {title && <h2>{title}</h2>}
                        {showCloseButton && (
                            <button onClick={onClose} className="modal-close-btn" aria-label="Close">
                                ×
                            </button>
                        )}
                    </div>
                )}
                {children}
            </div>
        </div>,
        document.body
    );
};
