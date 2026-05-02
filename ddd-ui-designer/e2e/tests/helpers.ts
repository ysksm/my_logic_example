import { expect, type Page, type Locator } from "@playwright/test";

/**
 * UI helpers expressing intent rather than DOM details so the tests stay
 * readable when markup changes.
 */
export class Designer {
  constructor(public readonly page: Page) {}

  topbar(): Locator { return this.page.locator(".topbar"); }
  leftPane(): Locator { return this.page.locator(".pane").nth(0); }
  centerPane(): Locator { return this.page.locator(".pane").nth(1); }
  rightPane(): Locator { return this.page.locator(".pane").nth(2); }

  async open() {
    await this.page.goto("/");
    await expect(this.topbar().locator("h1")).toHaveText("ddd-ui-designer");
  }

  async treeItems(): Promise<Locator> {
    return this.leftPane().locator(".tree-item");
  }

  async selectAggregate(name: string) {
    await this.leftPane().locator(".tree-item", { hasText: name }).first().click();
    await expect(this.centerPane().locator("h2")).toContainText("Aggregate:");
  }

  async addAggregate() {
    await this.leftPane().getByRole("button", { name: "+ 追加" }).click();
  }

  async removeAggregate(name: string) {
    this.page.once("dialog", (d) => d.accept());
    const row = this.leftPane().locator(".tree-item", { hasText: name });
    await row.locator("button.danger").click();
  }

  async setAggregateName(name: string) {
    const input = this.centerPane().locator('label.row:has-text("名前") input').first();
    await input.fill(name);
  }

  async toggleSingleton(on: boolean) {
    const cb = this.centerPane().locator('label.row:has-text("Singleton?") input[type="checkbox"]').first();
    if ((await cb.isChecked()) !== on) await cb.click();
  }

  async setUIHintPattern(pattern: "" | "P1" | "P2" | "P3" | "P4" | "P5") {
    const sel = this.centerPane().locator('label.row:has-text("Pattern") select').first();
    await sel.selectOption(pattern);
  }

  /** Adds a field to the Root Entity. */
  async addRootField(name: string, type: string) {
    const center = this.centerPane();
    // The center pane has the Root Entity FieldsEditor first. Use the "+ field"
    // button immediately after the Root Entity subhead.
    const button = center
      .locator(':text("Root Entity")')
      .locator("..")
      .locator(':text("+ field")')
      .first();
    await button.click();
    // The newly added row is the last field-row in the Root Entity block.
    // We set name + type on it.
    const rows = center.locator(".field-row");
    const last = rows.last();
    await last.locator('input[placeholder="name"]').fill(name);
    await last.locator("select").first().selectOption(type);
  }

  async addChildEntity(name: string) {
    const center = this.centerPane();
    await center.getByRole("button", { name: "+ 子Entity追加" }).click();
    // Last <details> below "子 Entities" subhead — set its name
    const childDetails = center.locator("details").last();
    await childDetails.locator("summary").click();
    const nameInput = childDetails.locator('label.row:has-text("名前") input').first();
    await nameInput.fill(name);
  }

  /** Selects child names for the Root Entity. */
  async selectChildrenForRoot(names: string[]) {
    const center = this.centerPane();
    const select = center
      .locator(':text("Root Entity")')
      .locator("..")
      .locator('label.row:has-text("子Entity (children)") select')
      .first();
    await select.selectOption(names);
  }

  async setSmallLimit(n: number) {
    await this.topbar().locator('input[type="number"]').first().fill(String(n));
  }

  async setWizardLimit(n: number) {
    await this.topbar().locator('input[type="number"]').nth(1).fill(String(n));
  }

  async setFilterSelectedOnly(on: boolean) {
    const cb = this.topbar().locator('input[type="checkbox"]');
    if ((await cb.isChecked()) !== on) await cb.click();
  }

  async derive() {
    await this.topbar().getByRole("button", { name: "▶ 派生" }).click();
    // Wait for at least one plan card to appear.
    await expect(this.rightPane().locator(".plan-card").first()).toBeVisible();
  }

  async planCardFor(aggregateName: string): Promise<Locator> {
    return this.rightPane().locator(".plan-card", { hasText: aggregateName });
  }

  async expectPattern(aggregateName: string, pattern: string) {
    const card = await this.planCardFor(aggregateName);
    await expect(card.locator(".pattern-badge")).toHaveText(pattern);
  }

  async setDomainMeta(id: string, name: string) {
    const idInput = this.topbar().locator('input[placeholder="id"]');
    const nameInput = this.topbar().locator('input[placeholder="name"]');
    await idInput.fill(id);
    await nameInput.fill(name);
  }
}
