import {forwardRef, type AnchorHTMLAttributes} from 'react';
import {Link} from 'react-router';

// Routes every Astryx <Link href> / <Button href> through React Router, so
// in-app links are client-side navigations relative to the studio basename.
export const RouterLink = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement>>(function RouterLink(
  {href = '', children, ...props},
  ref,
) {
  const external = /^(?:[a-z]+:)?\/\//i.test(href) || href.startsWith('tel:') || href.startsWith('mailto:') || href.startsWith('#');
  if (external) {
    return (
      <a ref={ref} href={href} {...props}>
        {children}
      </a>
    );
  }
  return (
    <Link ref={ref} to={href} {...props}>
      {children}
    </Link>
  );
});
