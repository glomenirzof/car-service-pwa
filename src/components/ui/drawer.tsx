// shadcn/ui Drawer — Base UI branch (style "base-nova"), built on
// @base-ui/react/drawer. This project uses ONLY this branch: no vaul, no
// vaul-era props (shouldScaleBackground, snapPoints-as-strings on Root from
// vaul, etc.). Classes use the Astryx Tailwind bridge tokens (bg-popover,
// text-primary, border-border ...) so the sheet shares one token set with
// Astryx components.
import * as React from 'react';
import {Drawer as DrawerPrimitive} from '@base-ui/react/drawer';
import {cn} from '@/lib/utils';

type RootProps = React.ComponentProps<typeof DrawerPrimitive.Root> & {
  /** Keep focused inputs above the software keyboard (forms inside the sheet). */
  keyboardAware?: boolean;
};

function Drawer({keyboardAware = true, children, ...props}: RootProps) {
  return (
    <DrawerPrimitive.Root data-slot="drawer" swipeDirection="down" {...props}>
      {keyboardAware ? <DrawerPrimitive.VirtualKeyboardProvider>{children as React.ReactNode}</DrawerPrimitive.VirtualKeyboardProvider> : children}
    </DrawerPrimitive.Root>
  );
}

function DrawerTrigger(props: React.ComponentProps<typeof DrawerPrimitive.Trigger>) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerPortal(props: React.ComponentProps<typeof DrawerPrimitive.Portal>) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />;
}

function DrawerClose(props: React.ComponentProps<typeof DrawerPrimitive.Close>) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

function DrawerOverlay({className, ...props}: React.ComponentProps<typeof DrawerPrimitive.Backdrop>) {
  return (
    <DrawerPrimitive.Backdrop
      data-slot="drawer-overlay"
      className={cn(
        'fixed inset-0 z-50 min-h-dvh bg-black opacity-[calc(0.6*(1-var(--drawer-swipe-progress,0)))]',
        'transition-opacity duration-[420ms] ease-[cubic-bezier(0.32,0.72,0,1)]',
        'data-starting-style:opacity-0 data-ending-style:opacity-0 data-swiping:duration-0',
        'supports-[-webkit-touch-callout:none]:absolute',
        className,
      )}
      {...props}
    />
  );
}

type ContentProps = React.ComponentProps<typeof DrawerPrimitive.Popup> & {
  /** Rendered above the scrollable body and never scrolls away. */
  header?: React.ReactNode;
  /** Pinned actions; lifted above the software keyboard. */
  footer?: React.ReactNode;
  bodyClassName?: string;
};

function DrawerContent({className, children, header, footer, bodyClassName, ...props}: ContentProps) {
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerPrimitive.Viewport data-slot="drawer-viewport" className="fixed inset-0 z-50 flex items-end justify-center">
        <DrawerPrimitive.Popup
          data-slot="drawer-content"
          className={cn(
            'relative flex max-h-[calc(100dvh-var(--safe-top,0px)-0.75rem)] w-full max-w-[36rem] flex-col',
            'rounded-t-xl border border-b-0 border-border bg-popover text-primary shadow-lg outline-none',
            '[transform:translateY(var(--drawer-swipe-movement-y,0px))]',
            'transition-transform duration-[420ms] ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform',
            'data-starting-style:[transform:translateY(100%)] data-ending-style:[transform:translateY(100%)]',
            'data-swiping:select-none data-ending-style:duration-[calc(var(--drawer-swipe-strength,1)*360ms)]',
            className,
          )}
          {...props}
        >
          <div aria-hidden className="mx-auto mt-2 mb-1 h-1 w-10 shrink-0 rounded-full bg-track" />
          {header ? <div className="shrink-0 px-4 pt-1 pb-2">{header}</div> : null}
          <DrawerPrimitive.Content
            className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4', !footer && 'pb-[calc(var(--safe-bottom,0px)+1rem)]', bodyClassName)}
          >
            {children}
          </DrawerPrimitive.Content>
          {footer ? (
            <div
              data-slot="drawer-footer"
              className="shrink-0 border-t border-border bg-popover px-4 pt-3 pb-[calc(0.75rem+var(--safe-bottom,0px)+var(--drawer-keyboard-inset,0px))]"
            >
              {footer}
            </div>
          ) : null}
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </DrawerPortal>
  );
}

function DrawerTitle({className, ...props}: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return <DrawerPrimitive.Title data-slot="drawer-title" className={cn('text-lg font-semibold text-primary', className)} {...props} />;
}

function DrawerDescription({className, ...props}: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return <DrawerPrimitive.Description data-slot="drawer-description" className={cn('text-sm text-secondary', className)} {...props} />;
}

export {Drawer, DrawerTrigger, DrawerPortal, DrawerOverlay, DrawerContent, DrawerTitle, DrawerDescription, DrawerClose};
