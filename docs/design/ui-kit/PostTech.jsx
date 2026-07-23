import React from 'react';
import { SiteHeader } from '../../components/core/SiteHeader.jsx';
import { SiteFooter } from '../../components/core/SiteFooter.jsx';
import { TagPill } from '../../components/core/TagPill.jsx';
import { FramedFigure } from '../../components/cards/FramedFigure.jsx';
import { CodeBlock } from '../../components/cards/CodeBlock.jsx';
import { AuthorCard } from '../../components/cards/AuthorCard.jsx';
import { PrevNext } from '../../components/cards/PrevNext.jsx';
import { Icon } from '../../components/core/Icon.jsx';

/** Tech post page: framed hero, article body with code block + blockquote, author card, prev/next. */
export function PostTech({ theme, onToggleTheme, onNavigate }) {
  const body = { fontFamily: 'var(--font-body)', fontSize: 'var(--text-article)', lineHeight: 'var(--leading-article)', color: 'var(--text-body)', margin: 0 };
  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <div style={{ maxWidth: 'var(--page-max)', margin: '0 auto', padding: 'var(--page-pad-top) var(--page-pad-x) 44px', display: 'flex', flexDirection: 'column', gap: '26px' }}>
        <SiteHeader active="blog" theme={theme} onToggleTheme={onToggleTheme} onNavigate={onNavigate} />

        <div
          onClick={onNavigate ? () => onNavigate('blog') : undefined}
          style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Icon name="move-left" size={13} /> all posts
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-page-title)', fontWeight: 800, lineHeight: 1.12, letterSpacing: 'var(--tracking-display)', color: 'var(--ink)' }}>
            Why I still hand-roll my CSS
          </div>
          <div style={{ display: 'flex', gap: '14px', alignItems: 'center', fontFamily: 'var(--font-mono)', fontSize: '12.5px', color: 'var(--text-muted)' }}>
            <span>jun 14, 2026</span><span>·</span><span>6 min read</span><span>·</span>
            <TagPill topic="code">code</TagPill>
          </div>
        </div>

        <FramedFigure height={240} placeholder="hero image · 16:9" caption="optional caption or image credit" />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <p style={body}>
            Every year someone tells me my stylesheet workflow is obsolete. Every year I ship faster than the person telling me.
            This post is about why plain CSS — with a few conventions — still beats the framework treadmill for personal projects
            and even mid-size products.
          </p>
          <p style={body}>
            The argument usually starts with utility classes. And look, I get it:{' '}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', background: 'var(--tint-sand)', borderRadius: '4px', padding: '1px 6px' }}>
              flex items-center gap-2
            </span>{' '}
            is fast to type. But speed of typing was never the bottleneck.
          </p>

          <CodeBlock filename="card.css">
            <span style={{ color: 'var(--code-selector)' }}>.card</span>{' {\n  '}
            <span style={{ color: 'var(--code-property)' }}>display</span>{': grid;\n  '}
            <span style={{ color: 'var(--code-property)' }}>gap</span>{': '}
            <span style={{ color: 'var(--code-value)' }}>12px</span>{';\n  '}
            <span style={{ color: 'var(--code-property)' }}>padding</span>{': '}
            <span style={{ color: 'var(--code-value)' }}>1rem 1.25rem</span>{';\n}'}
          </CodeBlock>

          <p style={body}>
            Naming things forces you to decide what things <em>are</em>. That act of deciding is where half my design bugs get
            caught — before the browser ever renders them.
          </p>

          <blockquote
            style={{
              margin: 0, borderLeft: '3px solid var(--accent)', padding: '2px 0 2px 18px',
              fontFamily: 'var(--font-body)', fontSize: '17px', lineHeight: 1.6, color: 'var(--text-body)', fontStyle: 'italic',
            }}
          >
            A stylesheet you can read top to bottom is documentation. A class soup is a scavenger hunt.
          </blockquote>
        </div>

        <AuthorCard photoSrc="../../assets/photos/luke-headshot.jpg" />
        <PrevNext prev="Notes on shipping a design system solo" next="Kelly Brook loop — first century of the year" />
        <SiteFooter />
      </div>
    </div>
  );
}
