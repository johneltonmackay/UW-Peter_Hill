/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/search'], function(record, search) {
    function beforeSubmit(context) {
        var validTypes = [context.UserEventType.CREATE, context.UserEventType.EDIT, context.UserEventType.DELETE];
        if (validTypes.indexOf(context.type) === -1) return;

        var po = context.newRecord;

        if (context.type === context.UserEventType.DELETE) {
            handleDelete(po);
            return;
        }

        var itemCount = po.getLineCount('item');

        for (var i = 0; i < itemCount; i++) {
            var itemId = po.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i });
            var quantity = po.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i });
            var rate = po.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: i });
            var isAdjusted = po.getSublistValue({ sublistId: 'item', fieldId: 'custcol_adjusted_flag', line: i });

            if (itemId == 30727 && (!isAdjusted || context.type === context.UserEventType.EDIT)) { // Item A and not already adjusted or being edited
                var itemBCost = getVendorCost(30453); // Fetch vendor cost of Item B
                var totalItemBCost = itemBCost * quantity;

                var adjustedRate = rate - itemBCost; // Deduct cost of Item B
                adjustedRate = adjustedRate < 0 ? 0 : adjustedRate; // Ensure adjusted rate does not go negative

                po.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'rate',
                    line: i,
                    value: adjustedRate
                });

                // Optional: Set custom fields for transparency
                po.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_original_cost', // Custom field for original cost
                    line: i,
                    value: rate
                });

                po.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_cost_adjustment', // Custom field for adjustment
                    line: i,
                    value: totalItemBCost
                });

                po.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_adjusted_flag', // Custom field to track adjustments
                    line: i,
                    value: true
                });

                handleTransferOrder(po.id, quantity, context.type);
            }
        }
    }

    function getVendorCost(itemId) {
        try {
            var searchResult = search.lookupFields({
                type: 'inventoryitem',
                id: itemId,
                columns: ['custitem_vendor_cost']
            });
            return parseFloat(searchResult.custitem_vendor_cost || 0);
        } catch (e) {
            log.error('Error Fetching Vendor Cost', 'Item ID: ' + itemId + ', Error: ' + e.message);
            return 0;
        }
    }

    function handleTransferOrder(poId, quantity, eventType) {
        try {
            var existingTransferOrderId = findExistingTransferOrder(poId);

            if (existingTransferOrderId) {
                if (eventType === context.UserEventType.EDIT) {
                    updateTransferOrder(existingTransferOrderId, quantity);
                }
            } else {
                createTransferOrder(poId, quantity);
            }
        } catch (e) {
            log.error('Error Handling Transfer Order', e.message);
        }
    }

    function createTransferOrder(poId, quantity) {
        try {
            var transferOrder = record.create({ type: 'transferorder', isDynamic: true });
            transferOrder.setValue({ fieldId: 'location', value: 24 }); // Aquatec location
            transferOrder.setValue({ fieldId: 'transferlocation', value: 1 }); // Finished goods location
            transferOrder.setValue({ fieldId: 'orderstatus', value: 'B' }); // Automatically approve the transfer order

            transferOrder.setValue({ fieldId: 'custbody_related_po', value: poId }); // Link to PO

            transferOrder.selectNewLine({ sublistId: 'item' });
            transferOrder.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: 30453 });
            transferOrder.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: quantity });
            transferOrder.commitLine({ sublistId: 'item' });

            var transferOrderId = transferOrder.save();
            log.debug('Transfer Order Created and Approved', 'Transfer Order ID: ' + transferOrderId);
        } catch (e) {
            log.error('Error Creating Transfer Order', e.message);
        }
    }

    function updateTransferOrder(transferOrderId, quantity) {
        try {
            var transferOrder = record.load({ type: 'transferorder', id: transferOrderId, isDynamic: true });

            transferOrder.selectLine({ sublistId: 'item', line: 0 }); // Assuming single line
            transferOrder.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: quantity });
            transferOrder.commitLine({ sublistId: 'item' });

            transferOrder.save();
            log.debug('Transfer Order Updated', 'Transfer Order ID: ' + transferOrderId);
        } catch (e) {
            log.error('Error Updating Transfer Order', e.message);
        }
    }

    function findExistingTransferOrder(poId) {
        try {
            var searchResult = search.create({
                type: 'transferorder',
                filters: [['custbody_related_po', 'is', poId]],
                columns: ['internalid']
            }).run().getRange({ start: 0, end: 1 });

            if (searchResult.length > 0) {
                return searchResult[0].getValue('internalid');
            }

            return null;
        } catch (e) {
            log.error('Error Finding Existing Transfer Order', e.message);
            return null;
        }
    }

    function handleDelete(po) {
        try {
            var existingTransferOrderId = findExistingTransferOrder(po.id);

            if (existingTransferOrderId) {
                record.delete({ type: 'transferorder', id: existingTransferOrderId });
                log.debug('Transfer Order Deleted', 'Transfer Order ID: ' + existingTransferOrderId);
            }
        } catch (e) {
            log.error('Error Deleting Transfer Order', e.message);
        }
    }

    return {
        beforeSubmit: beforeSubmit
    };
});
