import { expect, Locator, Page, test } from "@playwright/test";
import * as fs from "node:fs";
import { addMonths, isBefore, parse } from "date-fns";

const PRODUCER_LIST = [
  "19GRAMS",
  "3FE",
  "BONANZA COFFEE",
  "BRACIA ZIÓŁKOWSCY",
  "BYMYBEAN",
  "CASINO MOCCA",
  "COFFEE PLANT",
  "COFFEELAB",
  "DAK COFFEE ROASTERS",
  "DOUBLESHOT",
  "FATHER'S COFFEE",
  "FIGA COFFEE",
  "FIVE ELEPHANT",
  "GARDELLI SPECIALITY COFFEES",
  "GOOD COFFEE",
  "HARD BEANS",
  "HAYB",
  "KAFAR",
  "KLARO",
  "KYOTO",
  "LA CABRA",
  "LEŃ COFFEE",
  "LYKKE",
  "MAMAM",
  "NOMAD COFFEE",
  "ONYX COFFEE LAB",
  "PALOMA",
  "ROCKET BEAN",
  "SPOJKA",
  "STORY COFFEE ROASTERS",
  "THE COFFEE COLLECTIVE",
  "TRIGGER",
];

const FLAVOURS = [
  "owoce cytrusowe",
  "owoce czerwone",
  "owoce leśne",
  "owoce suszone",
  "owoce tropikalne",
  "owoce żółte",
  "przyprawy",
  "słodkie",
];

const MIN_PRICE = "40";
const MAX_PRICE = "80";

const confirmCookies = async (page: Page) => {
  const cookieConfirmButton = page.locator(
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  );
  await cookieConfirmButton.click();
};

async function selectFromMultiSelectFilter(
  filterContainer: Locator,
  optionsToSelect: string[],
) {
  await filterContainer.click();
  const availableOptions = await filterContainer.locator("li").all();
  for (const availableOption of availableOptions) {
    const availableOptionText = (
      (await availableOption.textContent()) ?? ""
    ).trim();

    if (
      optionsToSelect.some((option) =>
        availableOptionText.toLowerCase().startsWith(option.toLowerCase()),
      ) &&
      (await availableOption.locator("input").getAttribute("disabled")) == null
    ) {
      await availableOption.locator("label").click();
    }
  }
}

async function filterByProducers(page: Page) {
  const producerDropdown = page.locator(".filter-multi-select-manufacturer");
  // Show all manufacturers (by default only 5 are visible)
  const showAllBtn = producerDropdown.locator(
    ".coffeedesk-filter-show-all-toggle",
  );
  if ((await showAllBtn.count()) > 0) {
    await showAllBtn.click();
  }
  await selectFromMultiSelectFilter(producerDropdown, PRODUCER_LIST);
}

async function sortByPrice(page: Page) {
  const sortingDropdown = page.locator(".filter-multi-select-sorting");
  await sortingDropdown.click();
  const priceAscOption = sortingDropdown.getByText("Cena (rosnąco)");
  await priceAscOption.click();
}

async function moreFilters(_page: Page) {
  // No longer needed: all filters (price, flavours) are in the same panel as producers
}

async function setPrice(page: Page) {
  // Expand the "Cena" (price) section if it is collapsed
  const cenaToggle = page.locator('[data-filter-name="Cena"]');
  if ((await cenaToggle.getAttribute("aria-expanded")) !== "true") {
    await cenaToggle.click();
  }
  await page.locator(".form-control.min-input").fill(MIN_PRICE);
  await page.locator(".form-control.max-input").fill(MAX_PRICE);
}

async function setFlavours(page: Page) {
  // Target the parent .filter-multi-select container (which holds both the toggle
  // button and the li options), not just the button text element.
  const flavoursSection = page
    .locator(".filter-panel-items-container .filter-multi-select")
    .filter({ hasText: "Nuty smakowe" });
  await selectFromMultiSelectFilter(flavoursSection, FLAVOURS);
}

async function onlyFreshRoast(product: Locator) {
  const roastDateLoc = product.locator(".product-box__roasting-data");
  try {
    if (!(await roastDateLoc.isVisible())) return false;
    const roastDateText = await roastDateLoc.textContent();

    if (!roastDateText) return false;

    const roastDate = parse(
      roastDateText.substring("Data palenia:".length).trim(),
      "dd.MM.yyyy",
      new Date(),
    );

    if (isBefore(roastDate, addMonths(new Date(), -2))) {
      console.log("Roasting date too late: " + roastDate);
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

async function productIsAvailable(product: Locator) {
  return !(await product.locator(".product-detail-not-available").isVisible());
}

async function getAllCoffees(page: Page) {
  return await page.locator(".product-box").all();
}

async function waitForLoaderToDetach(page: Page) {
  await page.waitForLoadState("networkidle");
}

async function goToNextPage(page: Page) {
  const nextPageBtn = page.locator(".page-next");
  await nextPageBtn.click();
  await waitForLoaderToDetach(page);
}

async function getAvailableCoffees(allCoffees: Locator[]) {
  return await Promise.all(
    allCoffees.map(
      async (coffee) =>
        [coffee, await productIsAvailable(coffee as Locator)] as [
          Locator,
          boolean,
        ],
    ),
  ).then((coffees) =>
    coffees.filter(([, isAvailable]) => isAvailable).map(([coffee]) => coffee),
  );
}

async function getFreshCoffees(availableCoffees: Locator[]) {
  return await Promise.all(
    availableCoffees.map(
      async (coffee) =>
        [coffee, await onlyFreshRoast(coffee)] as [Locator, boolean],
    ),
  ).then((coffees) =>
    coffees.filter(([, isFresh]) => isFresh).map(([coffee]) => coffee),
  );
}

test("get all interesting coffees", async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  await page.goto(
    "https://www.coffeedesk.pl/kawa/metoda-parzenia/przelewowe-metody-parzenia/",
  );
  await page.addStyleTag({
    content:
      "#snrs-popup-wrapper-ns, .snrs-modal-wrapper {display: none !important;}",
  });
  await confirmCookies(page);
  await filterByProducers(page);
  await sortByPrice(page);
  await moreFilters(page);
  await setPrice(page);
  await setFlavours(page);
  await waitForLoaderToDetach(page);

  const listedProductsHrefs = [];

  do {
    const allCoffees = await getAllCoffees(page);
    const availableCoffees = await getAvailableCoffees(allCoffees);
    const freshCoffees = await getFreshCoffees(availableCoffees);
    const freshCoffeesLinks = await Promise.all(
      freshCoffees.map((coffee) =>
        coffee.locator(".product-info a.product-name").getAttribute("href"),
      ),
    );

    listedProductsHrefs.push(
      ...freshCoffeesLinks
        .filter((href) => !/Sie-Przelewa/.test(href ?? ""))
        .filter((href) => !/Coffee-Plant-Flow-/.test(href ?? "")),
    );

    if (allCoffees.length !== availableCoffees.length) {
      break;
    }

    try {
      let nextPageBtn = page.locator(".page-next");
      await expect(nextPageBtn).not.toHaveClass(/disabled/);
    } catch (e) {
      break;
    }

    await goToNextPage(page);
  } while (true);

  if (!fs.existsSync("out")) {
    fs.mkdirSync("out");
  }
  fs.writeFileSync("./out/hrefs.txt", listedProductsHrefs.join("\n"));
});
