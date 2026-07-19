/**
 * Baton docs — section overview page. Rendered for /docs/section/:groupSlug.
 * Shows the section intro and a clean card list of its pages.
 */
import type { DocGroup } from './registry';
import { Lead, Cards, Card } from './ui';

export function SectionIndex({ group }: { group: DocGroup }) {
  return (
    <>
      <p className="bd-eyebrow">Section</p>
      <h1>{group.title}</h1>
      <Lead>{group.intro}</Lead>
      <Cards>
        {group.items.map((it) => (
          <Card key={it.slug} to={it.slug} title={it.title}>
            {it.description}
          </Card>
        ))}
      </Cards>
    </>
  );
}
