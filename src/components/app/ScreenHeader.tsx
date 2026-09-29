import {useEffect, useRef, type ReactNode} from 'react';
import {useNavigate, useLocation} from 'react-router';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack, StackItem} from '@astryxdesign/core/Stack';
import {ChevronLeft} from 'lucide-react';

/**
 * Screen title bar. Focus moves to the title on navigation so screen-reader
 * and keyboard users land at the top of the new screen.
 */
export function ScreenHeader({title, back, actions}: {title: string; back?: string | true; actions?: ReactNode}) {
  const navigate = useNavigate();
  const location = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus({preventScroll: true});
  }, [location.pathname]);
  const goBack = () => {
    const hasHistory = (window.history.state as {idx?: number} | null)?.idx;
    if (hasHistory) navigate(-1);
    else navigate(typeof back === 'string' ? back : '/');
  };
  return (
    <header className="app-safe-top sticky top-0 z-30 bg-body/90 backdrop-blur-md">
      <HStack gap={2} paddingInline={4} paddingBlock={3} align="center">
        {back ? <IconButton icon={<ChevronLeft size={20} />} label="Назад" variant="ghost" onClick={goBack} /> : null}
        <StackItem size="fill">
          <div ref={ref} tabIndex={-1} className="outline-none">
            <Heading level={1} maxLines={1} className="text-xl">
              {title}
            </Heading>
          </div>
        </StackItem>
        {actions}
      </HStack>
    </header>
  );
}
