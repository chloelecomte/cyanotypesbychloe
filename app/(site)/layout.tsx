import Link from 'next/link';
import { InstagramIcon, MailIcon } from '@/components/icons';
import './site.css';

const INSTAGRAM = 'https://www.instagram.com/cyanotypes.by.chloe';

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="site">
      <header>
        <section>
          <h1 className="logo"><Link href="/">Cyanotypes by Chloé</Link></h1>
        </section>
        <nav>
          <Link href="/tools/negative-studio">Negative Studio</Link>
          <a href={INSTAGRAM} className="social-link">
            <InstagramIcon title="Instagram logo, link to @cyanotypes.by.chloe" />
          </a>
        </nav>
      </header>
      <main>{children}</main>
      <footer>
        <section className="link-list">
          <a href="mailto:hello@cyanotypesbychloe.com" className="social-link">
            <MailIcon title="Mail logo" />
            <span>hello@cyanotypesbychloe.com</span>
          </a>
          <a href={INSTAGRAM} className="social-link">
            <InstagramIcon title="Instagram logo" />
            <span>@cyanotypes.by.chloe</span>
          </a>
        </section>
      </footer>
    </div>
  );
}
