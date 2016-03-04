
import {Channel, X, Y, ROW, COLUMN} from '../channel';
import {LAYOUT} from '../data';
import {ScaleType, BANDSIZE_FIT} from '../scale';
import {Formula} from '../transform';
import {extend, keys, StringSet} from '../util';
import {VgData} from '../vega.schema';


import {FacetModel} from './facet';
import {TEXT as TEXT_MARK} from '../mark';
import {Model} from './model';
import {rawDomain} from './time';
import {UnitModel} from './unit';

// FIXME: for nesting x and y, we need to declare x,y layout separately before joining later
// For now, let's always assume shared scale
export interface LayoutComponent {
  width: SizeComponent;
  height: SizeComponent;
}

export interface SizeComponent {
  /** Field that we need to calculate distinct */
  distinct: StringSet;

  /** Dict from field name to expression */
  formula: Formula[];
}

export function assembleLayout(model: Model, layoutData: VgData[]): VgData[] {
  const layoutComponent = model.component.layout;
  if (!layoutComponent.width && !layoutComponent.height) {
    return layoutData; // Do nothing
  }

  if (true) { // if both are shared scale, we can simply merge data source for width and for height
    const distinctFields = keys(extend(layoutComponent.width.distinct, layoutComponent.height.distinct));
    const formula = layoutComponent.width.formula.concat(layoutComponent.height.formula)
      .map(function(formula) {
        return extend({type: 'formula'}, formula);
      });

    return [
      distinctFields.length > 0 ? {
        name: model.dataName(LAYOUT),
        source: model.dataTable(),
        transform: [{
            type: 'aggregate',
            summarize: distinctFields.map(function(field) {
              return { field: field, ops: ['distinct'] };
            })
          }].concat(formula)
      } : {
        name: model.dataName(LAYOUT),
        values: [{}],
        transform: formula
      }
    ];
  }
  // FIXME: implement
  // otherwise, we need to join width and height (cross)
}

// FIXME: for nesting x and y, we need to declare x,y layout separately before joining later
// For now, let's always assume shared scale
export function parseUnitLayout(model: UnitModel): LayoutComponent {
  return {
    width: parseUnitSizeLayout(model, X),
    height: parseUnitSizeLayout(model, Y)
  };
}

function parseUnitSizeLayout(model: UnitModel, channel: Channel): SizeComponent {
  const staticCellSize = channel === X ? model.cellWidth() : model.cellHeight();

  return {
    distinct: getDistinct(model, channel),
    formula: [{
      field: model.channelSizeName(channel),
      expr: unitSizeExpr(model, channel, staticCellSize)
    }]
  };
}

function unitSizeExpr(model: UnitModel, channel: Channel, staticCellSize: number): string {
  if (model.has(channel)) {
    if (model.isOrdinalScale(channel) && model.scale(channel).bandSize !== BANDSIZE_FIT) {
      const scale = model.scale(channel);
      return '(' + cardinalityFormula(model, channel) +
        ' + ' + 1 +
        ') * ' + scale.bandSize;
    } else {
      return staticCellSize + '';
    }
  } else {
    // TODO: need a way to set this to fit when using with layering.
    if (model.mark() === TEXT_MARK && channel === X) {
      // for text table without x/y scale we need wider bandSize
      return model.config().scale.textBandWidth + '';
    }
    return model.config().scale.bandSize + '';
  }
}

export function parseFacetLayout(model: FacetModel): LayoutComponent {
  return {
    width: parseFacetSizeLayout(model, COLUMN),
    height: parseFacetSizeLayout(model, ROW)
  };
}

function parseFacetSizeLayout(model: FacetModel, channel: Channel): SizeComponent {
  const childLayoutComponent = model.child().component.layout;
  const sizeType = channel === ROW ? 'height' : 'width';
  const childSizeComponent: SizeComponent = childLayoutComponent[sizeType];

  if (true) { // assume shared scale
    // For shared scale, we can simply merge the layout into one data source

    const distinct = extend(getDistinct(model, channel), childSizeComponent.distinct);
    const formula = childSizeComponent.formula.concat([{
      field: model.channelSizeName(channel),
      expr: facetSizeFormula(model, channel, model.child().channelSizeName(channel))
    }]);

    delete childLayoutComponent[sizeType];
    return {
      distinct: distinct,
      formula: formula
    };
  }
  // FIXME implement independent scale as well
  // TODO: - also consider when children have different data source
}

function facetSizeFormula(model: Model, channel: Channel, innerSize: string) {
  const scale = model.scale(channel);
  if (model.has(channel)) {
    return '(datum.' + innerSize + ' + ' + scale.padding + ')' + ' * ' + cardinalityFormula(model, channel);
  } else {
    return 'datum.' + innerSize + ' + ' + model.config().facet.scale.padding; // need to add outer padding for facet
  }
}

function getDistinct(model: Model, channel: Channel): StringSet {
  if (model.has(channel) && model.isOrdinalScale(channel)) {
    const scale = model.scale(channel);
    if (scale.type === ScaleType.ORDINAL && !(scale.domain instanceof Array)) {
      // if explicit domain is declared, use array length
      const distinctField = model.field(channel);
      let distinct: StringSet = {};
      distinct[distinctField] = true;
      return distinct;
    }
  }
  return {};
}

// TODO: rename to cardinalityExpr
function cardinalityFormula(model: Model, channel: Channel) {
  const scale = model.scale(channel);
  if (scale.domain instanceof Array) {
    return scale.domain.length;
  }

  const timeUnit = model.fieldDef(channel).timeUnit;
  const timeUnitDomain = timeUnit ? rawDomain(timeUnit, channel) : null;

  return timeUnitDomain !== null ? timeUnitDomain.length :
        model.field(channel, {datum: true, prefn: 'distinct_'});
}
